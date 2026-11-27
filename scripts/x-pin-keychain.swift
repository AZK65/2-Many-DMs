import Foundation
import Security

// Private pipe protocol: no PINs in arguments, files, diagnostics, or status.
// Use the login keychain without iCloud sync or background permission prompts.
SecKeychainSetUserInteractionAllowed(false)
func reply(_ value: [String: Any]) -> Never {
    let data = try! JSONSerialization.data(withJSONObject: value)
    FileHandle.standardOutput.write(data)
    exit(0)
}
func check(_ status: OSStatus) {
    if status != errSecSuccess { reply(["error": "keychain_unavailable"]) }
}
let input = FileHandle.standardInput.readDataToEndOfFile()
guard input.count < 4096,
      let value = try? JSONSerialization.jsonObject(with: input) as? [String: String],
      let command = value["command"], let account = value["account"],
      let binding = value["binding"],
      account.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
      binding.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil
else { reply(["error": "invalid_request"]) }
let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: "com.2manydms.x-chat-pin",
    kSecAttrAccount as String: account,
    kSecAttrSynchronizable as String: false,
]
let armed = Data((binding + ":armed").utf8)
let paused = Data((binding + ":paused").utf8)
if command == "forget" {
    let status = SecItemDelete(query as CFDictionary)
    if status != errSecItemNotFound { check(status) }
    reply(["saved": false, "autoUnlock": false])
}
if command == "save" {
    guard let pin = value["pin"], pin.range(of: "^[0-9]{4}$", options: .regularExpression) != nil
    else { reply(["error": "invalid_request"]) }
    let attributes: [String: Any] = [kSecValueData as String: Data(pin.utf8), kSecAttrGeneric as String: armed]
    let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
    if status == errSecItemNotFound {
        check(SecItemAdd(query.merging(attributes) { _, new in new }.merging([
            kSecAttrLabel as String: "2ManyDMs X Chat PIN"
        ]) { _, new in new } as CFDictionary, nil))
    } else { check(status) }
    reply(["saved": true, "autoUnlock": true])
}
var result: CFTypeRef?
let status = SecItemCopyMatching(query.merging([
    kSecReturnAttributes as String: true, kSecMatchLimit as String: kSecMatchLimitOne
]) { _, new in new } as CFDictionary, &result)
if status == errSecItemNotFound { reply(["saved": false, "autoUnlock": false]) }
check(status)
let metadata = (result as? [String: Any])?[kSecAttrGeneric as String] as? Data
let matches = metadata == armed || metadata == paused
if command == "status" { reply(["saved": matches, "autoUnlock": metadata == armed]) }
if command == "resume" {
    if matches { check(SecItemUpdate(query as CFDictionary, [kSecAttrGeneric as String: armed] as CFDictionary)) }
    reply(["saved": matches, "autoUnlock": matches])
}
if command == "take" {
    guard metadata == armed else { reply(["saved": matches, "autoUnlock": false]) }
    // Disarm BEFORE returning the secret. A failed attempt or process crash
    // cannot repeatedly submit the same PIN after later worker restarts.
    check(SecItemUpdate(query as CFDictionary, [kSecAttrGeneric as String: paused] as CFDictionary))
    var secret: CFTypeRef?
    check(SecItemCopyMatching(query.merging([
        kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne
    ]) { _, new in new } as CFDictionary, &secret))
    guard let data = secret as? Data, let pin = String(data: data, encoding: .utf8),
          pin.range(of: "^[0-9]{4}$", options: .regularExpression) != nil
    else { reply(["error": "invalid_secret"]) }
    reply(["pin": pin])
}
reply(["error": "invalid_request"])

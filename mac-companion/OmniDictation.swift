import AppKit
import ApplicationServices
import Foundation
import Network
import Security

// Local-only bridge. No microphone, clipboard, transcript or network-to-Wispr access.
enum BridgePolicy {
  static let port: UInt16 = 43821
  static func origin(_ value: String) -> Bool {
    guard let url = URLComponents(string: value), let host = url.host,
          url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
          url.path.isEmpty, !host.isEmpty else { return false }
    return url.scheme == "https" || (url.scheme == "http" && ["localhost", "127.0.0.1", "[::1]"].contains(host))
  }
  static func host(_ value: String) -> Bool { value == "127.0.0.1:\(port)" }
  static func equal(_ lhs: String, _ rhs: String) -> Bool {
    let a = Array(lhs.utf8), b = Array(rhs.utf8)
    guard a.count == b.count, !a.isEmpty else { return false }
    return zip(a, b).reduce(UInt8(0)) { $0 | ($1.0 ^ $1.1) } == 0
  }
}

@main
final class OmniDictation: NSObject, NSApplicationDelegate {
  private var listener: NWListener?
  private var statusItem: NSStatusItem!
  private var pairingCode = ""
  private var pairingExpires = Date.distantPast
  private var failedPairs = 0
  private var pairBlockedUntil = Date.distantPast
  private var grants: [String: String] = [:]
  private var lastTrigger = Date.distantPast
  private var requests: [String: Date] = [:]
  private var serviceStatus = "Local dictation helper"
  private let directory = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/OmniDictation")

  static func main() {
    if CommandLine.arguments.contains("--self-test") {
      precondition(BridgePolicy.origin("https://crm.example.com"))
      precondition(BridgePolicy.origin("http://127.0.0.1:3000"))
      for value in ["null", "http://evil.example", "https://a.example/path", "https://u:p@a.example", "https://a.example?x=1", "file:///"] { precondition(!BridgePolicy.origin(value)) }
      precondition(BridgePolicy.host("127.0.0.1:43821"))
      precondition(!BridgePolicy.host("evil.example:43821"))
      precondition(BridgePolicy.equal("secret", "secret"))
      precondition(!BridgePolicy.equal("secret", "secrex"))
      precondition(!BridgePolicy.equal("", ""))
      print("OmniDictation policy checks passed")
      return
    }
    let app = NSApplication.shared
    let delegate = OmniDictation()
    app.delegate = delegate
    app.setActivationPolicy(.accessory)
    app.run()
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    if let data = try? Data(contentsOf: directory.appendingPathComponent("paired-sites.json")),
       let saved = try? JSONDecoder().decode([String: String].self, from: data) { grants = saved }
    statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    statusItem.button?.image = NSImage(systemSymbolName: "mic.circle", accessibilityDescription: "Omni Dictation")
    menu()
    do {
      let parameters = NWParameters.tcp
      parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: BridgePolicy.port)!)
      listener = try NWListener(using: parameters)
      listener?.stateUpdateHandler = { [weak self] state in
        if case .failed = state { self?.serviceStatus = "Helper unavailable: port 43821 is in use"; self?.menu() }
      }
      listener?.newConnectionHandler = { [weak self] connection in self?.receive(connection) }
      listener?.start(queue: .main)
    } catch { serviceStatus = "Helper could not start"; menu() }
  }

  private func menu() {
    let menu = NSMenu()
    menu.addItem(withTitle: serviceStatus, action: nil, keyEquivalent: "")
    for (title, action) in [("Pair Omni on this Mac…", #selector(pairCode)), ("Accessibility permission…", #selector(accessibility)), ("Download Wispr Flow…", #selector(download)), ("Open Wispr Flow", #selector(openWispr)), ("Forget paired Omni sites…", #selector(forget)), ("Quit Omni Dictation", #selector(quit))] {
      let item = menu.addItem(withTitle: title, action: action, keyEquivalent: "")
      item.target = self
    }
    statusItem.menu = menu
  }

  @objc private func pairCode() {
    pairingCode = String(format: "%06d", Int.random(in: 0...999999))
    pairingExpires = Date().addingTimeInterval(300)
    let alert = NSAlert()
    alert.messageText = "Pair Omni Dictation"
    alert.informativeText = "Enter \(pairingCode) in Omni’s mic setup within five minutes. Pair only your own Omni address. A paired site can trigger Wispr’s shortcut while a dictation text box is focused."
    alert.addButton(withTitle: "Done")
    NSApp.activate(ignoringOtherApps: true)
    alert.runModal()
  }
  @objc private func accessibility() {
    let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
    _ = AXIsProcessTrustedWithOptions(options)
    NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!)
  }
  @objc private func download() { NSWorkspace.shared.open(URL(string: "https://wisprflow.ai/downloads")!) }
  private func wisprURL() -> URL? {
    let roots = [URL(fileURLWithPath: "/Applications"), FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications")]
    return roots.flatMap { (try? FileManager.default.contentsOfDirectory(at: $0, includingPropertiesForKeys: nil)) ?? [] }
      .first { $0.pathExtension == "app" && $0.lastPathComponent.lowercased().contains("wispr") }
  }
  @objc private func openWispr() {
    if let url = wisprURL() { NSWorkspace.shared.openApplication(at: url, configuration: NSWorkspace.OpenConfiguration()) }
    else { download() }
  }
  @objc private func forget() {
    let alert = NSAlert(); alert.messageText = "Forget paired Omni sites?"
    alert.informativeText = "All sites will need to pair again. Your chats and Wispr account are unchanged."
    alert.addButton(withTitle: "Forget sites"); alert.addButton(withTitle: "Cancel")
    if alert.runModal() == .alertFirstButtonReturn { grants = [:]; try? saveGrants() }
  }
  @objc private func quit() { NSApp.terminate(nil) }
  private func saveGrants() throws {
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    let file = directory.appendingPathComponent("paired-sites.json")
    try JSONEncoder().encode(grants).write(to: file, options: .atomic)
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
  }

  private func receive(_ connection: NWConnection) {
    connection.start(queue: .main)
    DispatchQueue.main.asyncAfter(deadline: .now() + 8) { connection.cancel() }
    read(connection, Data())
  }
  private func read(_ connection: NWConnection, _ previous: Data) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { [weak self] data, _, complete, error in
      guard let self else { connection.cancel(); return }
      var buffer = previous
      if let data { buffer.append(data) }
      guard buffer.count <= 8192, error == nil else { connection.cancel(); return }
      guard let divider = buffer.range(of: Data("\r\n\r\n".utf8)), let head = String(data: buffer[..<divider.lowerBound], encoding: .utf8) else {
        if !complete { self.read(connection, buffer) } else { connection.cancel() }; return
      }
      let lines = head.components(separatedBy: "\r\n")
      let first = (lines.first ?? "").components(separatedBy: " ")
      var headers: [String: String] = [:]
      for line in lines.dropFirst() {
        guard let colon = line.firstIndex(of: ":") else { connection.cancel(); return }
        let name = String(line[..<colon]).lowercased()
        guard headers[name] == nil else { connection.cancel(); return }
        headers[name] = String(line[line.index(after: colon)...]).trimmingCharacters(in: .whitespaces)
      }
      guard first.count == 3, BridgePolicy.host(headers["host"] ?? ""), headers["transfer-encoding"] == nil else { connection.cancel(); return }
      let length = Int(headers["content-length"] ?? "0") ?? -1
      guard length >= 0, length <= 2048 else { connection.cancel(); return }
      let body = Data(buffer[divider.upperBound...])
      if body.count < length && !complete { self.read(connection, buffer); return }
      guard body.count == length else { connection.cancel(); return }
      self.handle(connection, first[0], first[1], headers, body)
    }
  }

  private func handle(_ c: NWConnection, _ method: String, _ route: String, _ h: [String: String], _ body: Data) {
    let origin = h["origin"] ?? ""
    guard BridgePolicy.origin(origin) else { reply(c, 403, "", ["error": "A valid Omni site origin is required."]); return }
    if method == "OPTIONS" { reply(c, 204, origin, [:]); return }
    guard method == "POST", h["content-type"]?.lowercased().hasPrefix("application/json") == true,
          let payload = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any] else {
      reply(c, 400, origin, ["error": "Expected a JSON POST."]); return
    }
    if route == "/pair" {
      guard Date() >= pairBlockedUntil else { reply(c, 429, origin, ["error": "Too many attempts. Wait one minute."]); return }
      guard Date() < pairingExpires, BridgePolicy.equal(payload["code"] as? String ?? "", pairingCode) else {
        failedPairs += 1
        if failedPairs >= 5 { pairBlockedUntil = Date().addingTimeInterval(60); failedPairs = 0 }
        reply(c, 403, origin, ["error": "Open the Omni Dictation menu-bar icon for a fresh pairing code."]); return
      }
      var random = [UInt8](repeating: 0, count: 32)
      guard SecRandomCopyBytes(kSecRandomDefault, random.count, &random) == errSecSuccess else { reply(c, 500, origin, ["error": "Could not create pairing token."]); return }
      let token = Data(random).base64EncodedString()
      grants[origin] = token
      do { try saveGrants() } catch { grants.removeValue(forKey: origin); reply(c, 500, origin, ["error": "Could not save pairing."]); return }
      pairingCode = ""; pairingExpires = .distantPast; failedPairs = 0
      reply(c, 200, origin, ["token": token]); return
    }
    guard let token = grants[origin], BridgePolicy.equal(h["x-omni-token"] ?? "", token) else { reply(c, 401, origin, ["error": "Pair this Omni address with the Mac helper first."]); return }
    let installed = wisprURL()
    let running = installed.flatMap { Bundle(url: $0)?.bundleIdentifier }.map { !NSRunningApplication.runningApplications(withBundleIdentifier: $0).isEmpty } ?? false
    if route == "/status" {
      reply(c, 200, origin, ["version": 1, "installed": installed != nil, "running": running, "accessibility": AXIsProcessTrusted()]); return
    }
    guard route == "/toggle", let requestID = payload["requestId"] as? String, UUID(uuidString: requestID) != nil else { reply(c, 400, origin, ["error": "Invalid action."]); return }
    requests = requests.filter { Date().timeIntervalSince($0.value) < 600 }
    if requests[requestID] != nil { reply(c, 200, origin, ["triggered": true]); return }
    guard installed != nil, running else { reply(c, 409, origin, ["error": "Install and open Wispr Flow, sign in, and finish its setup first."]); return }
    guard AXIsProcessTrusted() else { reply(c, 403, origin, ["error": "Enable Omni Dictation in macOS Privacy & Security → Accessibility."]); return }
    guard Date().timeIntervalSince(lastTrigger) >= 1 else { reply(c, 429, origin, ["error": "Wait a moment before toggling dictation again."]); return }
    // A paired site cannot turn this into a generic keyboard automation API.
    // Trigger only with our explicitly labelled, editable dictation box focused.
    let system = AXUIElementCreateSystemWide()
    var focusedValue: CFTypeRef?
    guard AXUIElementCopyAttributeValue(system, kAXFocusedUIElementAttribute as CFString, &focusedValue) == .success,
          let focusedValue, CFGetTypeID(focusedValue) == AXUIElementGetTypeID() else { reply(c, 409, origin, ["error": "Click the Wispr dictation text box and try again."]); return }
    let focused = unsafeBitCast(focusedValue, to: AXUIElement.self)
    var role: CFTypeRef?, description: CFTypeRef?, title: CFTypeRef?
    AXUIElementCopyAttributeValue(focused, kAXRoleAttribute as CFString, &role)
    AXUIElementCopyAttributeValue(focused, kAXDescriptionAttribute as CFString, &description)
    AXUIElementCopyAttributeValue(focused, kAXTitleAttribute as CFString, &title)
    guard [kAXTextAreaRole, kAXTextFieldRole].contains(role as? String ?? ""),
          [description as? String, title as? String].contains("Omni Wispr dictation draft") else {
      reply(c, 409, origin, ["error": "Keep Omni’s dictation draft focused. This browser may not expose its text fields to Accessibility."]); return
    }
    // Match a user-configured hands-free shortcut. No private Wispr API/token extraction.
    // Ctrl + Option + Space is supported by Wispr; users add it during setup.
    guard let down = CGEvent(keyboardEventSource: nil, virtualKey: 49, keyDown: true),
          let up = CGEvent(keyboardEventSource: nil, virtualKey: 49, keyDown: false) else { reply(c, 500, origin, ["error": "Could not generate the shortcut."]); return }
    down.flags = [.maskControl, .maskAlternate]; up.flags = [.maskControl, .maskAlternate]
    lastTrigger = Date(); requests[requestID] = Date()
    down.post(tap: .cghidEventTap); up.post(tap: .cghidEventTap)
    reply(c, 200, origin, ["triggered": true]) // Shortcut sent, not a claim Wispr is recording.
  }

  private func reply(_ c: NWConnection, _ status: Int, _ origin: String, _ object: [String: Any]) {
    let body = (try? JSONSerialization.data(withJSONObject: object)) ?? Data()
    let cors = origin.isEmpty ? "" : "Access-Control-Allow-Origin: \(origin)\r\nVary: Origin\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, X-Omni-Token\r\nAccess-Control-Allow-Private-Network: true\r\n"
    let head = "HTTP/1.1 \(status) Response\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nConnection: close\r\n\(cors)Content-Length: \(body.count)\r\n\r\n"
    c.send(content: Data(head.utf8) + body, completion: .contentProcessed { _ in c.cancel() })
  }
}

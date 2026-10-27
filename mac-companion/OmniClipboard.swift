import AppKit
import Foundation

@main
final class OmniClipboard: NSObject, NSApplicationDelegate {
  private var statusItem: NSStatusItem!
  private var timer: Timer?
  private var lastChange = NSPasteboard.general.changeCount
  private var lastEmail = ""
  private var lastStatus = "Watching for copied emails"

  static func main() {
    let app = NSApplication.shared
    let delegate = OmniClipboard()
    app.delegate = delegate
    app.setActivationPolicy(.accessory)
    app.run()
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    statusItem.button?.image = NSImage(systemSymbolName: "envelope.badge", accessibilityDescription: "OmniCRM email capture")
    rebuildMenu()
    timer = Timer.scheduledTimer(timeInterval: 0.6, target: self, selector: #selector(checkClipboard), userInfo: nil, repeats: true)
  }

  private var baseURL: String {
    let configured = UserDefaults.standard.string(forKey: "crmURL")?.trimmingCharacters(in: .whitespacesAndNewlines)
    return (configured?.isEmpty == false ? configured! : "http://localhost:3000").trimmingCharacters(in: CharacterSet(charactersIn: "/"))
  }

  @objc private func checkClipboard() {
    let pasteboard = NSPasteboard.general
    guard pasteboard.changeCount != lastChange else { return }
    lastChange = pasteboard.changeCount
    guard let text = pasteboard.string(forType: .string), text.count <= 10_000 else { return }
    let pattern = #"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}"#
    guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return }
    let range = NSRange(text.startIndex..<text.endIndex, in: text)
    let emails = Set(regex.matches(in: text, range: range).compactMap { result -> String? in
      guard let r = Range(result.range, in: text) else { return nil }
      return String(text[r]).lowercased()
    })
    let sourceApp = NSWorkspace.shared.frontmostApplication?.localizedName ?? "Unknown app"
    for email in emails { capture(email: email, sourceApp: sourceApp) }
  }

  private func capture(email: String, sourceApp: String) {
    guard let url = URL(string: "\(baseURL)/api/clipboard-captures") else { return }
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.timeoutInterval = 8
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try? JSONSerialization.data(withJSONObject: ["email": email, "sourceApp": sourceApp])
    URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
      DispatchQueue.main.async {
        guard let self else { return }
        if let data, let result = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let count = result["matchCount"] as? Int {
          self.lastEmail = email
          self.lastStatus = count == 0 ? "Saved email · no DM match yet" : "Matched to \(count) DM\(count == 1 ? "" : "s")"
        } else {
          self.lastStatus = error == nil ? "OmniCRM rejected capture" : "OmniCRM unavailable · will catch next copy"
        }
        self.rebuildMenu()
      }
    }.resume()
  }

  private func rebuildMenu() {
    let menu = NSMenu()
    let status = NSMenuItem(title: lastStatus, action: nil, keyEquivalent: "")
    status.isEnabled = false
    menu.addItem(status)
    if !lastEmail.isEmpty {
      let recent = NSMenuItem(title: lastEmail, action: #selector(copyRecent), keyEquivalent: "")
      recent.target = self
      menu.addItem(recent)
    }
    menu.addItem(.separator())
    let open = NSMenuItem(title: "Open OmniCRM Email Finder", action: #selector(openCRM), keyEquivalent: "o")
    open.target = self
    menu.addItem(open)
    let configure = NSMenuItem(title: "Set CRM URL…", action: #selector(setURL), keyEquivalent: ",")
    configure.target = self
    menu.addItem(configure)
    menu.addItem(.separator())
    let quit = NSMenuItem(title: "Quit OmniClipboard", action: #selector(quit), keyEquivalent: "q")
    quit.target = self
    menu.addItem(quit)
    statusItem.menu = menu
  }

  @objc private func copyRecent() { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(lastEmail, forType: .string); lastChange = NSPasteboard.general.changeCount }
  @objc private func openCRM() { if let url = URL(string: baseURL) { NSWorkspace.shared.open(url) } }
  @objc private func setURL() {
    let alert = NSAlert(); alert.messageText = "OmniCRM address"; alert.informativeText = "Use localhost now, or your HTTPS address after hosting."
    alert.addButton(withTitle: "Save"); alert.addButton(withTitle: "Cancel")
    let field = NSTextField(string: baseURL); field.frame = NSRect(x: 0, y: 0, width: 320, height: 24); alert.accessoryView = field
    if alert.runModal() == .alertFirstButtonReturn { UserDefaults.standard.set(field.stringValue, forKey: "crmURL"); lastStatus = "Connected to \(field.stringValue)"; rebuildMenu() }
  }
  @objc private func quit() { NSApplication.shared.terminate(nil) }
}

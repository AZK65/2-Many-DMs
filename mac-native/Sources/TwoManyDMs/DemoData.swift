import Foundation

enum DemoData {
    static let names = [("Maya Chen", "telegram", "Sounds good. See you there!", 2), ("Weekend plans", "whatsapp", "Nina: I’ll bring the coffee ☕", 4), ("Leo Martinez", "x", "Sent you the updated designs", 1), ("Studio team", "discord", "The new build looks great", 0), ("Sofia Laurent", "telegram", "That light is incredible", 0), ("Oliver Park", "whatsapp", "Let’s catch up tomorrow", 0)]
    static let chats: [Conversation] = names.enumerated().map { i, item in
        Conversation(id: "demo-\(i)", platform: item.1, unread: item.3,
                     lastMessageAt: ISO8601DateFormatter().string(from: Date().addingTimeInterval(Double(-i * 600))), lastMessage: item.2,
                     pinned: i == 0, hidden: false, archived: false, inboxCategory: "general", status: "open", isGroup: i == 1 || i == 3,
                     contact: Contact(name: item.0, handle: item.0.lowercased().replacingOccurrences(of: " ", with: "")), lastDirection: "in")
    }
    static let messages: [Message] = [
        message("1", "Hey! Did you get a chance to look at the space?", "in", -2400),
        message("2", "I did. The big windows and all that natural light are perfect.", "out", -2340),
        message("3", "Exactly what I was thinking. Somewhere we can slow down and make things.", "in", -2100),
        message("4", "How about Saturday morning? We can grab a coffee first.", "out", -1200),
        message("5", "10 works for me. There’s a little place around the corner.", "in", -1100),
        message("6", "Perfect. I’ll bring the camera 📷", "out", -900),
        message("7", "Sounds good. See you there!", "in", -60)
    ]
    static func message(_ id: String, _ body: String, _ direction: String, _ offset: TimeInterval) -> Message {
        Message(id: "demo-message-" + id, body: body, direction: direction, createdAt: ISO8601DateFormatter().string(from: Date().addingTimeInterval(offset)), deliveryStatus: direction == "out" ? "sent" : nil)
    }
    static func messagesFor(_ id: String) -> [Message] { id == "demo-0" ? messages : [message(id, chats.first { $0.id == id }?.lastMessage ?? "", "in", -60)] }
    static var shared: SharedContent {
        var photo = message("sample-photo", "", "in", -7200); photo.mediaType = "image"; photo.mediaName = "Sample landscape"
        return SharedContent(pinned: [], media: [photo], links: [SharedLink(id: "sample-link", messageId: "demo-message-1", url: "https://example.com/studio", body: "Studio inspiration", createdAt: photo.createdAt)])
    }
    static let networks = [NetworkStatus(id: "telegram", name: "Telegram", state: "ready", detail: "Live messages connected"), NetworkStatus(id: "whatsapp", name: "WhatsApp", state: "ready", detail: "Live messages connected"), NetworkStatus(id: "x", name: "X", state: "ready", detail: "Older history restoring in the background")]
}

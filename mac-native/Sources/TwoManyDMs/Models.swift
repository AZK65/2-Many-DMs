import Foundation

struct Contact: Codable, Equatable {
    var name: String
    var handle: String
    var avatarUrl: String?
    var email: String?
}

struct Account: Codable, Equatable {
    var id: String
    var label: String?
    var driver: String?
    var status: String
}

struct Conversation: Codable, Identifiable, Equatable {
    var id: String
    var platform: String
    var unread: Int
    var lastMessageAt: String
    var lastMessage: String?
    var pinned: Bool
    var hidden: Bool
    var archived: Bool
    var inboxCategory: String
    var status: String
    var isGroup: Bool
    var contact: Contact
    var account: Account?
    var lastDirection: String?
    var previewOnly: Bool?
    var translationEnabled: Bool?
    var translationLanguageName: String?
    var name: String { contact.name.isEmpty ? contact.handle : contact.name }
    var network: String { platform == "x" ? "X" : platform == "whatsapp" ? "WhatsApp" : platform.capitalized }
    var initials: String { name.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined().uppercased() }
    var date: Date { parseDate(lastMessageAt) }
}

struct Message: Codable, Identifiable, Equatable {
    var id: String
    var body: String
    var direction: String
    var createdAt: String
    var externalKey: String?
    var senderName: String?
    var mediaType: String?
    var mediaUrl: String?
    var mediaName: String?
    var deliveryStatus: String?
    var deliveryError: String?
    var replyPreview: String?
    var replySender: String?
    var deletedAt: String?
    var editedAt: String?
    var originalBody: String?
    var translatedBody: String?
    var pinnedAt: String?
    var replyToExternalKey: String?
    var reactions: [Reaction]?
    var outgoing: Bool { direction == "out" }
    var date: Date { parseDate(createdAt) }
    var preview: Bool { externalKey?.contains(":preview:") == true }
    var uncertain: Bool { ["unconfirmed", "pending"].contains(deliveryStatus ?? "") }
}

struct Reaction: Codable, Equatable { var emoji: String; var count: Int; var who: [String]? }

struct MessagePage: Decodable {
    var messages: [Message]; var hasMore: Bool
    var deliveries: [Message]?
    var missingObservedIds: [String]?
}
struct ConversationUpdate: Decodable {
    var id: String; var unread: Int; var lastMessageAt: String; var lastMessage: String?
    var archived: Bool; var inboxCategory: String; var status: String; var lastDirection: String?; var previewOnly: Bool?
    func applying(to previous: Conversation) -> Conversation {
        var next = previous
        next.unread = unread; next.lastMessageAt = lastMessageAt; next.lastMessage = lastMessage
        next.archived = archived; next.inboxCategory = inboxCategory; next.status = status
        next.lastDirection = lastDirection; next.previewOnly = previewOnly
        return next
    }
}
struct SendEnvelope: Decodable { var message: Message?; var error: String?; var pending: Bool? }
struct SearchHit: Decodable, Identifiable { var id: String; var conversationId: String; var body: String; var createdAt: String }
struct SearchPage: Decodable { var results: [SearchHit]; var hasMore: Bool? }
struct NetworkStatus: Identifiable, Equatable { var id: String; var name: String; var state: String; var detail: String }

private enum NativeDates {
    static let lock = NSLock()
    static let cache: NSCache<NSString, NSDate> = { let cache = NSCache<NSString, NSDate>(); cache.countLimit = 20000; return cache }()
    static let fractional: ISO8601DateFormatter = { let parser = ISO8601DateFormatter(); parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return parser }()
    static let seconds: ISO8601DateFormatter = { let parser = ISO8601DateFormatter(); parser.formatOptions = [.withInternetDateTime]; return parser }()
}
func parseDate(_ value: String) -> Date {
    if let cached = NativeDates.cache.object(forKey: value as NSString) { return cached as Date }
    NativeDates.lock.lock(); defer { NativeDates.lock.unlock() }
    let date = NativeDates.fractional.date(from: value) ?? NativeDates.seconds.date(from: value) ?? .distantPast
    NativeDates.cache.setObject(date as NSDate, forKey: value as NSString)
    return date
}

func sortedConversations(_ chats: [Conversation]) -> [Conversation] {
    // Parse once per chat, outside the sort comparator. The original formatter
    // allocation in every comparison blocked large real inboxes on startup.
    chats.map { (chat: $0, date: $0.date) }.sorted {
        if $0.chat.pinned != $1.chat.pinned { return $0.chat.pinned }
        if $0.date != $1.date { return $0.date > $1.date }
        return $0.chat.id < $1.chat.id
    }.map(\.chat)
}

func mergeMessages(_ existing: [Message], _ incoming: [Message]) -> [Message] {
    var byID: [String: Message] = [:], order: [String] = []
    for candidate in existing + incoming {
        var message = candidate
        if let prior = byID[message.id] {
            if prior.deletedAt != nil || (prior.editedAt != nil && parseDate(prior.editedAt!) > parseDate(message.editedAt ?? "")) || (nativeXKey(prior.externalKey) && message.preview) { continue }
            if message.outgoing && (["pending", "sending"].contains(message.deliveryStatus ?? "")) && ["sent", "failed", "unconfirmed"].contains(prior.deliveryStatus ?? "") {
                message.deliveryStatus = prior.deliveryStatus; message.deliveryError = prior.deliveryError; message.externalKey = prior.externalKey
            }
            if prior.mediaUrl != nil && message.mediaUrl == nil && prior.body == message.body { message.mediaUrl = prior.mediaUrl; message.mediaType = prior.mediaType; message.mediaName = prior.mediaName }
        } else { order.append(message.id) }
        byID[message.id] = message
    }
    return order.compactMap { byID[$0] }.enumerated().sorted { $0.element.date == $1.element.date ? $0.offset < $1.offset : $0.element.date < $1.element.date }.map(\.element)
}

func nativeXKey(_ key: String?) -> Bool { (key ?? "").range(of: "^x:(?:[a-f0-9]{8}-[a-f0-9-]{27}|[0-9]{10,})$", options: [.regularExpression, .caseInsensitive]) != nil }
func normalizedXText(_ text: String) -> String {
    text.replacingOccurrences(of: "\\bhttps?://(?=[a-z0-9.-]+\\.[a-z]{2,}\\b)", with: "", options: [.regularExpression, .caseInsensitive])
        .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines)
}
func previewMatches(_ preview: String, _ full: String) -> Bool {
    let short = normalizedXText(preview), complete = normalizedXText(full)
    if short == complete { return true }
    let prefix = short.replacingOccurrences(of: "(?:…|\\.{3})$", with: "", options: .regularExpression).trimmingCharacters(in: .whitespaces)
    if prefix != short && prefix.count >= 24 && complete.hasPrefix(prefix) { return true }
    guard short.count >= 24, complete.count > short.count else { return false }
    return [full.trimmingCharacters(in: .whitespacesAndNewlines), complete].contains { text in
        normalizedXText(String(text.unicodeScalars.prefix(200))) == short || normalizedXText(String(decoding: text.utf16.prefix(200), as: UTF16.self)) == short
    }
}
func projectMessages(_ raw: [Message], platform: String) -> [Message] {
    let rows = mergeMessages([], raw)
    guard platform == "x" else { return rows }
    func plain(_ message: Message) -> Bool { message.preview && !message.id.hasPrefix("client_") && !message.body.isEmpty && message.mediaType == nil && message.mediaUrl == nil && message.pinnedAt == nil && message.originalBody == nil && message.translatedBody == nil && (message.reactions?.isEmpty ?? true) && message.replyToExternalKey == nil }
    let natives = rows.filter { nativeXKey($0.externalKey) }
    var previous: [String: Message] = [:]
    return rows.filter { message in
        if plain(message) {
            let sameDirection = natives.filter { $0.direction == message.direction }
            let matches = sameDirection.filter { $0.mediaType == nil && $0.mediaUrl == nil && previewMatches(message.body, $0.body) }
            let anchor = sameDirection.last { $0.date <= message.date } ?? sameDirection.first { $0.date <= message.date.addingTimeInterval(130) }
            if Set(matches.map { normalizedXText($0.body) }).count == 1, let anchor, matches.contains(where: { $0.id == anchor.id }) { return false }
            if let prior = previous[message.direction], plain(prior), normalizedXText(prior.body) == normalizedXText(message.body) { return false }
        }
        previous[message.direction] = message
        return true
    }
}

enum InboxFilter: String, CaseIterable, Identifiable {
    case all = "All", unread = "Unread", requests = "Requests"
    var id: Self { self }
    func includes(_ conversation: Conversation) -> Bool {
        guard !conversation.hidden, !conversation.archived else { return false }
        switch self {
        case .all: return conversation.inboxCategory != "spam"
        case .unread: return conversation.unread > 0 && conversation.inboxCategory != "spam"
        case .requests: return conversation.inboxCategory == "spam"
        }
    }
}

enum ClientError: LocalizedError {
    case invalidAddress, response(String), transport
    var errorDescription: String? {
        switch self {
        case .invalidAddress: return "Use a local address such as http://127.0.0.1:3000. Remote accounts are managed in the full workspace."
        case .response(let message): return message
        case .transport: return "The local service could not be reached. Start 2ManyDMs, then retry."
        }
    }
}

func localServiceURL(_ value: String) throws -> URL {
    guard let url = URL(string: value), ["http", "https"].contains(url.scheme ?? ""),
          ["localhost", "127.0.0.1", "[::1]", "::1"].contains(url.host ?? ""),
          url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
          url.path.isEmpty || url.path == "/" else { throw ClientError.invalidAddress }
    return url
}

// Persist in-flight identities before dispatch. A restart must not turn an
// unknown delivery into a fresh send with a second identity.
struct NativeSendAttempt: Codable, Equatable {
    var id: String
    var body: String
}
struct NativeDraftState: Codable {
    var drafts: [String: String]
    var attempts: [String: NativeSendAttempt]
}

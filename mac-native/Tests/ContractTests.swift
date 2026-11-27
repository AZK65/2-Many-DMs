import Foundation

final class FixtureProtocol: URLProtocol {
    static var captured: [URLRequest] = []
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.captured.append(request)
        let json = "{\"pending\":true,\"message\":{\"id\":\"client_fixture_123\",\"body\":\"Synthetic test\",\"direction\":\"out\",\"createdAt\":\"2026-11-27T14:00:00Z\",\"deliveryStatus\":\"unconfirmed\"}}"
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 202, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(json.utf8)); client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@main struct ContractTests {
    static func main() async throws {
        var count = 0
        func check(_ condition: @autoclosure () -> Bool, _ label: String) {
            guard condition() else { fatalError("FAIL: \(label)") }
            count += 1; print("PASS: \(label)")
        }
        for url in ["http://127.0.0.1:3000", "http://localhost:3310", "http://[::1]:3000"] {
            check((try? localServiceURL(url)) != nil, "local service accepted")
        }
        for url in ["https://example.com", "http://127.0.0.1.evil.test", "file:///etc/passwd", "http://user:secret@localhost:3000", "http://localhost:3000/?token=abc", "http://localhost:3000/other"] {
            check((try? localServiceURL(url)) == nil, "nonlocal or ambiguous address rejected")
        }
        let date = "2026-11-27T14:00:00Z"
        let original = Message(id: "one", body: "hello", direction: "out", createdAt: date, externalKey: "x:12345678900", deliveryStatus: "sent")
        var pending = original; pending.deliveryStatus = "pending"
        check(mergeMessages([original], [pending]).first?.deliveryStatus == "sent", "older response cannot undo delivery")
        check(mergeMessages([original], [original]).count == 1, "overlapping pages retain one native message")
        var repeated = original; repeated.id = "two"; repeated.externalKey = "x:12345678901"
        check(mergeMessages([original], [repeated]).count == 2, "genuine repeated text survives")
        var preview = original; preview.id = "preview"; preview.externalKey = "x:preview:one"
        check(projectMessages([original, preview], platform: "x").count == 1, "X inbox snapshot does not duplicate full message")
        check(projectMessages([original, repeated, preview], platform: "x").count == 2, "all distinct X native identities survive")
        check(projectMessages([original, preview], platform: "telegram").count == 2, "X presentation rules do not affect Telegram")
        check(!previewMatches("yes", "yes please"), "short replies are never fuzzy duplicates")
        var edited = original; edited.editedAt = "2026-11-27T14:05:00Z"; edited.body = "updated"
        check(mergeMessages([edited], [original]).first?.body == "updated", "stale response preserves edit")
        var deleted = original; deleted.deletedAt = date
        check(mergeMessages([deleted], [original]).first?.deletedAt != nil, "stale response preserves deletion")
        var photo = original; photo.mediaType = "image"; photo.mediaUrl = "/media/example.png"
        check(mergeMessages([photo], [original]).first?.mediaUrl != nil, "stale response preserves downloaded media")
        let api = LocalAPI(base: try localServiceURL("http://127.0.0.1:3000"))
        check(api.localMediaURL("/media/example.png")?.host == "127.0.0.1", "local media resolves within workspace")
        check(api.localMediaURL("https://other.example/photo.png") == nil, "attachment does not silently fetch external hosts")
        let requestURL = api.url("api/messages/search", query: [.init(name: "q", value: "a & b # c")])
        check(URLComponents(url: requestURL, resolvingAgainstBaseURL: false)?.queryItems?.first?.value == "a & b # c", "search encodes user text")
        let envelope = Data("{\"pending\":true,\"message\":{\"id\":\"client_test1234\",\"body\":\"hello\",\"direction\":\"out\",\"createdAt\":\"2026-11-27T14:00:00Z\",\"deliveryStatus\":\"unconfirmed\"}}".utf8)
        let decoded = try JSONDecoder().decode(SendEnvelope.self, from: envelope)
        check(decoded.message?.uncertain == true, "ambiguous send is kept for review")
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [FixtureProtocol.self]
        let fixture = LocalAPI(base: try localServiceURL("http://127.0.0.1:3999"), configuration: config)
        let sent = try await fixture.send("fixture-chat", body: "Synthetic test", clientID: "client_fixture_123", attachment: nil, replyID: "reply-1")
        check(sent.uncertain, "HTTP 202 preserves an uncertain send")
        check(FixtureProtocol.captured.count == 1, "uncertain send is never automatically retried")
        check(FixtureProtocol.captured.first?.httpMethod == "POST", "send uses the existing POST route")
        let fixtureRequest = FixtureProtocol.captured[0]
        var requestData = fixtureRequest.httpBody ?? Data()
        if let stream = fixtureRequest.httpBodyStream {
            stream.open(); defer { stream.close() }
            var buffer = [UInt8](repeating: 0, count: 1024)
            while stream.hasBytesAvailable { let read = stream.read(&buffer, maxLength: buffer.count); if read <= 0 { break }; requestData.append(buffer, count: read) }
        }
        let sentBody = try JSONSerialization.jsonObject(with: requestData) as? [String: String]
        check(sentBody?["clientMessageId"] == "client_fixture_123" && sentBody?["replyToMessageId"] == "reply-1", "send preserves exact request identity and reply target")
        let attempt = NativeSendAttempt(id: "client_fixture_123", body: "Synthetic draft")
        let journal = NativeDraftState(drafts: ["fixture-chat": attempt.body], attempts: ["fixture-chat": attempt])
        let restored = try JSONDecoder().decode(NativeDraftState.self, from: JSONEncoder().encode(journal))
        check(restored.attempts["fixture-chat"] == attempt && restored.drafts["fixture-chat"] == attempt.body, "draft and unresolved send identity survive a restart together")
        check(api.localMediaURL("http://user:secret@127.0.0.1:3000/media/example.png") == nil, "media URL cannot inject credentials")
        var cache = NativeChatCache(capacity: 2, messageLimit: 2)
        cache.store("first", messages: [original, repeated, photo], hasMore: false)
        check(cache.take("first")?.messages.count == 2 && cache.take("first")?.hasMore == true, "chat cache bounds memory and preserves older history access")
        cache.store("second", messages: [original], hasMore: false)
        _ = cache.take("first")
        cache.store("third", messages: [repeated], hasMore: false)
        check(cache.take("second") == nil && cache.take("first") != nil, "chat cache evicts least recently opened conversations")
        cache.store("first", messages: [], hasMore: false)
        check(cache.take("first")?.messages.isEmpty == false, "empty loading state cannot erase cached history")
        cache.remove("first")
        check(cache.take("first") == nil, "confirmed removals cannot reappear from the chat cache")
        var grouped = original; grouped.createdAt = "2026-11-27T14:01:00Z"
        check(messagesAreGrouped(original, grouped), "adjacent same-sender messages form a visual group")
        grouped.direction = "in"
        check(!messagesAreGrouped(original, grouped), "different directions do not group")
        grouped = original; grouped.createdAt = "2026-11-27T15:00:00Z"
        check(!messagesAreGrouped(original, grouped), "large time gaps start a new message group")
        let sharedJSON = Data("""
        {"pinned":[],"media":[{"id":"photo","body":"","direction":"in","createdAt":"2026-11-27T14:00:00Z","mediaType":"image","mediaUrl":null,"mediaName":"Example photo"},{"id":"file","body":"","direction":"in","createdAt":"2026-11-27T14:00:00Z","mediaType":"document","mediaUrl":"/media/example.pdf","mediaName":"Example.pdf"}],"links":[{"id":"link","messageId":"original","url":"https://example.com/article","body":"A link","createdAt":"2026-11-27T14:00:00Z"}]}
        """.utf8)
        let shared = try JSONDecoder().decode(SharedContent.self, from: sharedJSON)
        check(shared.photos.map(\.id) == ["photo"] && shared.files.map(\.id) == ["file"], "details separates saved photos and files, including undownloaded media")
        check(shared.links.first?.safeURL?.host == "example.com", "shared links keep their original destination")
        for destination in ["javascript:alert(1)", "file:///etc/passwd", "https://user:secret@example.com"] {
            var unsafe = shared.links[0]; unsafe.url = destination
            check(unsafe.safeURL == nil, "shared links reject unsafe schemes or embedded credentials")
        }
        let formatter = ISO8601DateFormatter()
        let bulk = (0..<5000).map { index in
            Conversation(id: "bulk-\(index)", platform: "x", unread: 0,
                lastMessageAt: formatter.string(from: Date(timeIntervalSince1970: Double(1700000000 + index))),
                pinned: false, hidden: false, archived: false, inboxCategory: "general", status: "open", isGroup: false,
                contact: Contact(name: "Synthetic contact", handle: "test"))
        }
        let began = Date()
        let sorted = sortedConversations(bulk)
        check(sorted.first?.id == "bulk-4999" && sorted.last?.id == "bulk-0", "large inbox retains newest-first ordering")
        check(Date().timeIntervalSince(began) < 5, "5000-chat initial sort stays within five seconds")
        let cachedStart = Date()
        for _ in 0..<10 { _ = sortedConversations(bulk) }
        check(Date().timeIntervalSince(cachedStart) < 5, "repeated large inbox renders reuse parsed dates")
        if CommandLine.arguments.contains("--live") {
            let chats: [Conversation] = try await api.get("api/conversations")
            check(!chats.isEmpty, "existing inbox decodes in native client")
            if let chat = chats.first {
                let page = try await api.messages(chat.id); check(!page.messages.isEmpty, "existing message contract decodes without marking read")
                let saved: SharedContent = try await api.get("api/conversations/\(chat.id)/shared")
                check(saved.photos.count + saved.files.count <= saved.media.count, "live shared-items response decodes for native details")
            }
            print("Live read-only contract verified. No messages sent or marked read.")
        }
        print("\(count) native contract checks passed.")
    }
}

import Foundation
import UniformTypeIdentifiers

final class LocalRedirectGuard: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        // Never forward a chat body, attachment, or stream to a redirect target.
        completionHandler(nil)
    }
}

final class LocalAPI {
    let base: URL
    let session: URLSession
    private let guardDelegate = LocalRedirectGuard()
    init(base: URL, configuration: URLSessionConfiguration = .ephemeral) {
        self.base = base
        let config = configuration
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 20
        config.timeoutIntervalForResource = 90
        session = URLSession(configuration: config, delegate: guardDelegate, delegateQueue: nil)
    }
    deinit { session.invalidateAndCancel() }

    func url(_ path: String, query: [URLQueryItem] = []) -> URL {
        var parts = URLComponents(url: base.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { parts.queryItems = query }
        return parts.url!
    }
    func data(_ path: String, query: [URLQueryItem] = []) async throws -> Data {
        let (data, response) = try await session.data(from: url(path, query: query))
        try validate(response, data)
        return data
    }
    func get<T: Decodable>(_ path: String, query: [URLQueryItem] = []) async throws -> T {
        try JSONDecoder().decode(T.self, from: await data(path, query: query))
    }
    func validate(_ response: URLResponse, _ data: Data) throws {
        guard let http = response as? HTTPURLResponse else { throw ClientError.transport }
        guard (200..<300).contains(http.statusCode) else {
            let envelope = try? JSONDecoder().decode(SendEnvelope.self, from: data)
            throw ClientError.response(envelope?.error ?? "The local service returned an error (\(http.statusCode)).")
        }
    }
    func patchConversation(_ id: String, body: [String: Any]) async throws {
        var request = URLRequest(url: url("api/conversations/\(id)"))
        request.httpMethod = "PATCH"; request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await session.data(for: request)
        try validate(response, data)
    }
    func messages(_ id: String, existing: [Message] = [], before: String? = nil, focus: String? = nil, markRead: Bool = false, recoveryID: String? = nil) async throws -> MessagePage {
        var query = [URLQueryItem(name: "limit", value: "75")]
        if let before { query.append(.init(name: "before", value: before)) }
        if let focus { query.append(.init(name: "focus", value: focus)) }
        if markRead { query.append(.init(name: "markRead", value: "1")) }
        let pending = existing.filter { $0.outgoing && ($0.uncertain || $0.deliveryStatus == "sending") }.suffix(50)
        var deliveryIDs = pending.map(\.id)
        if let recoveryID, !deliveryIDs.contains(recoveryID) { deliveryIDs.append(recoveryID) }
        query.append(.init(name: "deliveryIds", value: deliveryIDs.joined(separator: ",")))
        let observed = existing.filter { $0.externalKey != nil && !$0.id.hasPrefix("client_") }.suffix(50)
        query.append(.init(name: "observedIds", value: observed.map(\.id).joined(separator: ",")))
        return try await get("api/conversations/\(id)/messages", query: query)
    }
    func send(_ chatID: String, body: String, clientID: String, attachment: URL?, replyID: String?) async throws -> Message {
        var request = URLRequest(url: url("api/conversations/\(chatID)/messages"))
        request.httpMethod = "POST"; request.timeoutInterval = 65
        if let attachment {
            let metadata = try attachment.resourceValues(forKeys: [.fileSizeKey])
            guard (metadata.fileSize ?? 0) <= 25 * 1024 * 1024 else { throw ClientError.response("Choose a file smaller than 25 MB.") }
            let boundary = "TwoManyDMs-" + UUID().uuidString
            request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
            var data = Data()
            func append(_ value: String) { data.append(Data(value.utf8)) }
            for (key, value) in ["body": body, "clientMessageId": clientID, "replyToMessageId": replyID ?? ""] {
                append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(key)\"\r\n\r\n\(value)\r\n")
            }
            let name = attachment.lastPathComponent.replacingOccurrences(of: "\"", with: "_").replacingOccurrences(of: "\r", with: "_").replacingOccurrences(of: "\n", with: "_")
            let mime = UTType(filenameExtension: attachment.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
            append("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(name)\"\r\nContent-Type: \(mime)\r\n\r\n")
            data.append(try Data(contentsOf: attachment)); append("\r\n--\(boundary)--\r\n")
            request.httpBody = data
        } else {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: ["body": body, "clientMessageId": clientID, "replyToMessageId": replyID ?? ""])
        }
        let (data, response) = try await session.data(for: request)
        // An ambiguous send can return 202 with a saved message. Never resend it.
        if let envelope = try? JSONDecoder().decode(SendEnvelope.self, from: data), let message = envelope.message { return message }
        try validate(response, data)
        return try JSONDecoder().decode(Message.self, from: data)
    }
    func localMediaURL(_ raw: String?) -> URL? {
        guard let raw else { return nil }
        if raw.hasPrefix("/media/") || raw.hasPrefix("/api/") || raw.hasPrefix("/avatars/") { return URL(string: raw, relativeTo: base)?.absoluteURL }
        guard let url = URL(string: raw), url.scheme == base.scheme, url.host == base.host, url.port == base.port, url.user == nil, url.password == nil else { return nil }
        return url
    }
}

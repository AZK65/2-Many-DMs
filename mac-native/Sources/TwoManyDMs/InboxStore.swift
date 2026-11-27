import AppKit
import SwiftUI
import CryptoKit

@MainActor final class InboxStore: ObservableObject {
    @Published var conversations: [Conversation] = [] { didSet { rebuildVisible() } }
    @Published private(set) var visible: [Conversation] = []
    @Published var selectedID: String?
    @Published var messages: [Message] = []
    @Published var filter: InboxFilter = .all { didSet { rebuildVisible() } }
    @Published var platform = "all" { didSet { rebuildVisible() } }
    @Published var search = "" { didSet { rebuildVisible() } }
    @Published var searchHits: [SearchHit] = []
    @Published var searchBusy = false
    @Published var loading = true
    @Published var loadingChat = false
    @Published var loadingOlder = false
    @Published var hasMore = false
    @Published var online = false
    @Published var eventsConnected = false
    @Published var error: String?
    @Published var chatError: String?
    @Published private var sendErrors: [String: String] = [:]
    private var attempts: [String: NativeSendAttempt] = [:]
    @Published var networks: [NetworkStatus] = []
    @Published var drafts: [String: String] = [:]
    @Published var attachments: [String: URL] = [:]
    @Published var replies: [String: Message] = [:]
    @Published var sending = Set<String>()
    @Published var uncertainSends = Set<String>()
    @Published var focusedMessageID: String?
    let demo: Bool
    private(set) var api: LocalAPI
    private var refreshTask: Task<Void, Never>?
    private var eventTask: Task<Void, Never>?
    private var searchTask: Task<Void, Never>?
    private var selectionTask: Task<Void, Never>?
    private var draftSaveTask: Task<Void, Never>?
    private var chatCache = NativeChatCache()
    private var refreshing = false, refreshAgain = false
    private var lastRefresh = Date.distantPast
    private let defaults: UserDefaults
    private var etag: String?
    private var needsFullSnapshot = true
    private var lastEndpoint = ""

    init(demo: Bool = ProcessInfo.processInfo.arguments.contains("--demo") || Bundle.main.object(forInfoDictionaryKey: "TMDPreviewOnly") as? Bool == true) {
        self.demo = demo
        defaults = demo ? UserDefaults(suiteName: "com.2manydms.native.demo")! : .standard
        let saved = defaults.string(forKey: "serviceURL") ?? "http://127.0.0.1:3000"
        api = LocalAPI(base: (try? localServiceURL(saved)) ?? URL(string: "http://127.0.0.1:3000")!)
        if demo {
            conversations = DemoData.chats; selectedID = conversations.first?.id
            messages = DemoData.messages; networks = DemoData.networks; loading = false; online = true
        } else { loadDrafts() }
        rebuildVisible()
    }
    var sendError: String? {
        get { sendErrors[selectedID ?? ""] }
        set { sendErrors[selectedID ?? ""] = newValue }
    }
    var currentSendError: String? { sendError ?? (selectedID.map { uncertainSends.contains($0) } == true ? "An earlier send needs review. Check this chat in the full workspace before sending again." : nil) }
    var selected: Conversation? { conversations.first { $0.id == selectedID } }
    var unreadCount: Int { conversations.filter { !$0.archived && !$0.hidden }.reduce(0) { $0 + $1.unread } }
    private func rebuildVisible() {
        let next = sortedConversations(conversations.filter { filter.includes($0) && (platform == "all" || $0.platform == platform) &&
            (search.isEmpty || "\($0.name) \($0.contact.handle) \($0.lastMessage ?? "")".localizedCaseInsensitiveContains(search)) })
        if next != visible { visible = next }
    }
    var draft: String {
        get { drafts[selectedID ?? ""] ?? "" }
        set {
            guard let id = selectedID, drafts[id] != newValue else { return }
            drafts[id] = newValue
            draftSaveTask?.cancel()
            draftSaveTask = Task { [weak self] in
                do { try await Task.sleep(nanoseconds: 300_000_000); self?.saveDrafts() } catch {}
            }
        }
    }
    func flushDrafts() { draftSaveTask?.cancel(); saveDrafts() }
    var serviceAddress: String { api.base.absoluteString }
    var canSend: Bool { selectedID != nil && !sending.contains(selectedID!) && !uncertainSends.contains(selectedID!) &&
        (!draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || attachments[selectedID!] != nil) }

    func start() {
        guard !demo, refreshTask == nil else { return }
        refreshTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                if !eventsConnected || Date().timeIntervalSince(lastRefresh) > 30 {
                    await refresh()
                }
                try? await Task.sleep(nanoseconds: 3_000_000_000)
            }
        }
        eventTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                do {
                    var request = URLRequest(url: api.url("api/inbox/events")); request.timeoutInterval = 60
                    request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                    let (bytes, response) = try await api.session.bytes(for: request)
                    guard (response as? HTTPURLResponse)?.statusCode == 200,
                          response.mimeType == "text/event-stream" else { throw ClientError.transport }
                    eventsConnected = true; await refresh()
                    for try await line in bytes.lines {
                        if Task.isCancelled { break }
                        if line == "event: change" { Task { await self.refresh() } }
                    }
                } catch { /* Normal polling keeps older servers and reconnects usable. */ }
                eventsConnected = false
                try? await Task.sleep(nanoseconds: 5_000_000_000)
            }
        }
    }
    func stop() { flushDrafts(); refreshTask?.cancel(); eventTask?.cancel(); searchTask?.cancel(); selectionTask?.cancel(); refreshTask = nil; eventTask = nil }
    func refresh() async {
        guard !demo else { return }
        if refreshing { refreshAgain = true; return }
        refreshing = true
        defer { refreshing = false; if refreshAgain { refreshAgain = false; Task { await self.refresh() } } }
        let service = api
        do {
            let full = needsFullSnapshot || conversations.isEmpty
            let endpoint = full ? "full" : "poll"
            var request = URLRequest(url: service.url("api/conversations", query: full ? [] : [.init(name: "poll", value: "1")]))
            if let etag, lastEndpoint == endpoint { request.setValue(etag, forHTTPHeaderField: "If-None-Match") }
            let (data, response) = try await service.session.data(for: request)
            guard service === api else { return }
            if (response as? HTTPURLResponse)?.statusCode != 304 {
                try service.validate(response, data)
                if full {
                    let next = try JSONDecoder().decode([Conversation].self, from: data)
                    if next != conversations { conversations = next }
                    needsFullSnapshot = false
                }
                else {
                    let updates = try JSONDecoder().decode([ConversationUpdate].self, from: data)
                    let existing = Dictionary(conversations.map { ($0.id, $0) }, uniquingKeysWith: { _, next in next })
                    if updates.contains(where: { existing[$0.id] == nil }) {
                        let snapshot: [Conversation] = try await service.get("api/conversations")
                        guard service === api else { return }
                        if conversations != snapshot { conversations = snapshot }
                    } else {
                        let next = updates.compactMap { update in existing[update.id].map { update.applying(to: $0) } }
                        if next != conversations { conversations = next }
                    }
                }
                etag = (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "ETag")
                lastEndpoint = endpoint
            }
            online = true; error = nil; loading = false; lastRefresh = Date()
            if let id = selectedID { await refreshMessages(id) }
            if let raw = try? await service.data("api/connections"), service === api { readNetworks(raw) }
        } catch {
            guard service === api, !Task.isCancelled else { return }
            online = false; loading = false
            self.error = "The local inbox is offline. Saved drafts stay on this Mac."
        }
    }
    func select(_ id: String?, focus: String? = nil) {
        guard id != selectedID || focus != nil else { return }
        flushDrafts()
        if let current = selectedID { chatCache.store(current, messages: messages, hasMore: hasMore) }
        selectionTask?.cancel()
        selectedID = id; focusedMessageID = focus; chatError = nil; loadingChat = false
        guard let id else { messages = []; hasMore = false; return }
        if demo { messages = chatCache.take(id)?.messages ?? DemoData.messagesFor(id); hasMore = false; return }
        if let cached = chatCache.take(id) {
            messages = cached.messages; hasMore = cached.hasMore
        } else { messages = []; hasMore = false; loadingChat = true }
        selectionTask = Task {
            await refreshMessages(id, focus: focus, markRead: true)
            if selectedID == id { loadingChat = false }
        }
    }
    private func apply(_ page: MessagePage, older: Bool = false) {
        let removed = Set(page.missingObservedIds ?? [])
        let next = mergeMessages(messages.filter { !removed.contains($0.id) }, page.messages + (page.deliveries ?? []))
        if next != messages { messages = next }
        if older || messages.count <= 75 { hasMore = page.hasMore }
        if let id = selectedID {
            if messages.isEmpty { chatCache.remove(id) }
            else { chatCache.store(id, messages: messages, hasMore: hasMore) }
        }
    }
    func refreshMessages(_ id: String, focus: String? = nil, markRead: Bool = false) async {
        let service = api
        do {
            let page = try await service.messages(id, existing: messages, focus: focus, markRead: markRead, recoveryID: attempts[id]?.id)
            guard selectedID == id, service === api, !Task.isCancelled else { return }
            apply(page); chatError = nil
            if let attempt = attempts[id], let receipt = messages.first(where: { $0.id == attempt.id }) {
                if drafts[id] == attempt.body { drafts[id] = "" }
                attempts[id] = nil; uncertainSends.remove(id)
                sendErrors[id] = receipt.deliveryStatus == "unconfirmed" || receipt.deliveryStatus == "failed" ? "Delivery needs checking. Open the full workspace to review it." : nil
                saveDrafts()
            }
            if markRead, let index = conversations.firstIndex(where: { $0.id == id }) { conversations[index].unread = 0 }
        } catch {
            if selectedID == id && service === api && !Task.isCancelled { chatError = "This conversation could not refresh. Your draft is still here." }
        }
    }
    func older() async {
        guard let id = selectedID, let before = messages.first?.createdAt, !loadingOlder, !demo else { return }
        let service = api
        loadingOlder = true; defer { loadingOlder = false }
        do {
            let page = try await service.messages(id, before: before)
            guard service === api, selectedID == id else { return }
            apply(page, older: true)
        } catch { if service === api, selectedID == id { chatError = "Older messages could not load. Try again." } }
    }
    func send() async {
        guard let chat = selected, canSend else { return }
        let text = draft, attachment = attachments[chat.id], reply = replies[chat.id]
        let clientID = "client_" + UUID().uuidString
        sending.insert(chat.id); sendErrors[chat.id] = nil
        defer { sending.remove(chat.id) }
        if demo {
            messages.append(Message(id: clientID, body: text, direction: "out", createdAt: ISO8601DateFormatter().string(from: Date()), deliveryStatus: "sent"))
            drafts[chat.id] = ""; attachments[chat.id] = nil; replies[chat.id] = nil; return
        }
        attempts[chat.id] = NativeSendAttempt(id: clientID, body: text)
        guard saveDrafts() else { attempts[chat.id] = nil; return }
        do {
            let message = try await api.send(chat.id, body: text, clientID: clientID, attachment: attachment, replyID: reply?.id)
            if selectedID == chat.id { messages = mergeMessages(messages, [message]) }
            if drafts[chat.id] == text { drafts[chat.id] = "" }
            if attachments[chat.id] == attachment { attachments[chat.id] = nil }
            if replies[chat.id]?.id == reply?.id { replies[chat.id] = nil }
            attempts[chat.id] = nil; uncertainSends.remove(chat.id); saveDrafts()
            if message.deliveryStatus == "failed" || message.deliveryStatus == "unconfirmed" { sendErrors[chat.id] = message.deliveryError ?? "Delivery needs checking. Open the full workspace to review it." }
            await refresh()
        } catch ClientError.response(let detail) {
            attempts[chat.id] = nil; saveDrafts()
            sendErrors[chat.id] = detail
        } catch {
            // The server may have accepted a send before a timeout. Do not allow
            // another click to silently send a duplicate with a different ID.
            uncertainSends.insert(chat.id)
            sendErrors[chat.id] = "Delivery could not be confirmed. Your draft is saved. Check this conversation in the full workspace before sending again."
            await refreshMessages(chat.id)
        }
    }
    func acknowledgeUncertainSend(_ id: String) {
        let previous = attempts[id]
        attempts[id] = nil
        if saveDrafts() { uncertainSends.remove(id); sendErrors[id] = nil }
        else { attempts[id] = previous }
    }
    func attachFile() {
        guard let id = selectedID else { return }
        let panel = NSOpenPanel(); panel.canChooseDirectories = false; panel.allowsMultipleSelection = false
        panel.prompt = "Attach"; panel.message = "Choose a file up to 25 MB. It will be sent only when you press Send."
        if panel.runModal() == .OK, let url = panel.url {
            if ((try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0) > 25 * 1024 * 1024 { sendError = "Choose a file smaller than 25 MB." }
            else { attachments[id] = url }
        }
    }
    @discardableResult func update(_ chat: Conversation, body: [String: Any]) async -> Bool {
        if demo {
            if let index = conversations.firstIndex(where: { $0.id == chat.id }) {
                if let pinned = body["pinned"] as? Bool { conversations[index].pinned = pinned }
                if let status = body["status"] as? String { conversations[index].status = status }
            }
            return true
        }
        do { try await api.patchConversation(chat.id, body: body); error = nil; etag = nil; needsFullSnapshot = true; await refresh(); return true }
        catch { self.error = error.localizedDescription; return false }
    }
    func searchMessages() {
        searchTask?.cancel(); searchHits = []
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
        guard query.count >= 2 else { searchBusy = false; return }
        if demo { searchHits = DemoData.messages.filter { $0.body.localizedCaseInsensitiveContains(query) }.map { SearchHit(id: $0.id, conversationId: DemoData.chats[0].id, body: $0.body, createdAt: $0.createdAt) }; return }
        searchBusy = true
        searchTask = Task {
            do {
                try await Task.sleep(nanoseconds: 300_000_000)
                let page: SearchPage = try await api.get("api/messages/search", query: [.init(name: "q", value: query)])
                guard !Task.isCancelled, search.trimmingCharacters(in: .whitespacesAndNewlines) == query else { return }
                searchHits = page.results; searchBusy = false
            } catch { if !Task.isCancelled { searchBusy = false } }
        }
    }
    func reconnect(address: String) throws {
        guard sending.isEmpty else { throw ClientError.response("Wait for the current send to finish before changing the inbox.") }
        let base = try localServiceURL(address)
        guard saveDrafts() else { throw ClientError.response("Your draft could not be saved. Copy it before changing the inbox.") }
        stop(); api = LocalAPI(base: base); etag = nil; needsFullSnapshot = true; eventsConnected = false
        defaults.set(base.absoluteString, forKey: "serviceURL")
        conversations = []; messages = []; selectedID = nil; drafts = [:]; attachments = [:]; replies = [:]; loading = true
        chatCache = NativeChatCache()
        attempts = [:]; uncertainSends = []; sendErrors = [:]; networks = []; searchHits = []
        search = ""; filter = .all; platform = "all"; chatError = nil; error = nil; online = false
        focusedMessageID = nil; hasMore = false; loadingChat = false
        loadDrafts(); start()
    }
    func openWorkspace() {
        let query = selectedID.map { [URLQueryItem(name: "conversation", value: $0)] } ?? []
        NSWorkspace.shared.open(api.url("", query: query))
    }
    private func readNetworks(_ data: Data) {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let platforms = root["platforms"] as? [String: Any] else { return }
        let next: [NetworkStatus] = ["telegram", "whatsapp", "x", "discord", "gmail"].compactMap { platform -> NetworkStatus? in
            guard let value = platforms[platform] as? [String: Any], let state = value["state"] as? String else { return nil }
            let sync = value["sync"] as? [String: Any]
            let retry = (sync?["retryAt"] as? Double).map { Date(timeIntervalSince1970: $0 / 1000) > Date() } ?? false
            let queued = sync?["pendingChats"] as? Int ?? 0
            let detail = retry ? "Waiting for platform retry" : queued > 0 ? "\(queued) chats restoring older history" : (value["detail"] as? String ?? "")
            return NetworkStatus(id: platform, name: platform == "x" ? "X" : platform == "whatsapp" ? "WhatsApp" : platform.capitalized, state: state, detail: detail)
        }
        if networks != next { networks = next }
    }
    private var draftURL: URL {
        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("2ManyDMs")
        let hash = SHA256.hash(data: Data(serviceAddress.utf8)).prefix(8).map { String(format: "%02x", $0) }.joined()
        return root.appendingPathComponent("drafts-\(hash).json")
    }
    private func loadDrafts() {
        guard !demo, let data = try? Data(contentsOf: draftURL) else { return }
        if let saved = try? JSONDecoder().decode(NativeDraftState.self, from: data) {
            drafts = saved.drafts; attempts = saved.attempts; uncertainSends = Set(attempts.keys)
        } else if let legacy = try? JSONDecoder().decode([String: String].self, from: data) { drafts = legacy }
    }
    @discardableResult private func saveDrafts() -> Bool {
        guard !demo else { return true }
        do {
            try FileManager.default.createDirectory(at: draftURL.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            let data = try JSONEncoder().encode(NativeDraftState(drafts: drafts.filter { !$0.value.isEmpty }, attempts: attempts))
            try data.write(to: draftURL, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: draftURL.path)
            return true
        } catch { sendError = "This draft could not be saved to disk. Keep the app open until it is sent or copied."; return false }
    }
}

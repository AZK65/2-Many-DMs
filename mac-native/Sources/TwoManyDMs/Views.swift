import SwiftUI
import AppKit
import GlassBridge

struct NativeGlass: NSViewRepresentable {
    var radius: CGFloat = 16
    func makeNSView(context: Context) -> NSView { TMDGlassView(radius) }
    func updateNSView(_ nsView: NSView, context: Context) {}
}
struct SidebarMaterial: NSViewRepresentable {
    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView(); view.material = .sidebar; view.blendingMode = .behindWindow; view.state = .active
        return view
    }
    func updateNSView(_ nsView: NSVisualEffectView, context: Context) {}
}

struct InboxView: View {
    @EnvironmentObject var store: InboxStore
    @State private var showConnections = false
    @State private var showSettings = false
    @FocusState private var searchFocused: Bool
    var body: some View {
        HSplitView {
            sidebar.frame(minWidth: 260, idealWidth: 304, maxWidth: 340)
            if let chat = store.selected {
                ConversationView(chat: chat).id(chat.id).frame(minWidth: 480)
            } else {
                VStack(spacing: 16) {
                    Image(systemName: "bubble.left.and.bubble.right").font(.system(size: 48, weight: .light)).foregroundStyle(.secondary)
                    Text("Your conversations, together.").font(.title2.weight(.semibold))
                    Text(store.online ? "Choose a chat to pick up where you left off." : "Start your local 2ManyDMs service to see your inbox.")
                        .foregroundStyle(.secondary)
                    if !store.online { Button("Retry connection") { Task { await store.refresh() } }.buttonStyle(.borderedProminent) }
                }.frame(maxWidth: .infinity, maxHeight: .infinity).background(Color(nsColor: .windowBackgroundColor))
            }
        }
        .frame(minWidth: 820, minHeight: 560)
        .background(SidebarMaterial())
        .sheet(isPresented: $showSettings) { NativeSettings().environmentObject(store) }
        .onAppear { store.start() }
        .onReceive(NotificationCenter.default.publisher(for: .init("TwoManyDMs.find"))) { _ in searchFocused = true }
        .onReceive(NotificationCenter.default.publisher(for: .init("TwoManyDMs.settings"))) { _ in showSettings = true }
    }
    private var sidebar: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Messages").font(.title2.weight(.bold))
                Spacer()
                Menu {
                    Picker("Network", selection: $store.platform) {
                        Text("All networks").tag("all")
                        ForEach(Array(Set(store.conversations.map(\.platform))).sorted(), id: \.self) { item in
                            Text(item == "x" ? "X" : item == "whatsapp" ? "WhatsApp" : item.capitalized).tag(item)
                        }
                    }
                    Divider()
                    Button("Open full workspace", systemImage: "arrow.up.right.square") { store.openWorkspace() }
                    Button("Settings…", systemImage: "gearshape") { showSettings = true }
                } label: { Image(systemName: store.platform == "all" ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill").font(.title3) }
                .menuStyle(.borderlessButton).fixedSize().help("Filter networks and open workspace options")
                .accessibilityLabel("Inbox options")
            }.padding(.horizontal, 20).padding(.top, 40).padding(.bottom, 16)
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("Search chats and messages", text: $store.search).textFieldStyle(.plain).focused($searchFocused)
                if !store.search.isEmpty { Button { store.search = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary) }.buttonStyle(.plain).help("Clear search").accessibilityLabel("Clear search") }
            }.padding(10).background(.quaternary.opacity(0.55), in: RoundedRectangle(cornerRadius: 10)).padding(.horizontal, 16)
            Picker("Inbox", selection: $store.filter) {
                ForEach(InboxFilter.allCases) { filter in Text(filter.rawValue).tag(filter) }
            }.pickerStyle(.segmented).labelsHidden().padding(.horizontal, 16).padding(.vertical, 12)
            if store.platform != "all" {
                HStack { Text("Showing \(store.platform == "x" ? "X" : store.platform.capitalized)").font(.caption).foregroundStyle(.secondary); Spacer(); Button("Clear") { store.platform = "all" }.buttonStyle(.plain).font(.caption) }.padding(.horizontal, 20).padding(.bottom, 8)
            }
            if store.loading {
                VStack(spacing: 16) {
                    ForEach(0..<6) { _ in HStack(spacing: 12) { Circle().fill(.quaternary).frame(width: 44, height: 44); VStack(alignment: .leading, spacing: 8) { RoundedRectangle(cornerRadius: 4).fill(.quaternary).frame(width: 116, height: 12); RoundedRectangle(cornerRadius: 4).fill(.quaternary).frame(height: 10) } } }
                }.padding(20).accessibilityLabel("Loading conversations")
                Spacer()
            } else {
                List(selection: Binding(get: { store.selectedID }, set: { store.select($0) })) {
                    if store.visible.isEmpty && store.searchHits.isEmpty {
                        VStack(alignment: .leading, spacing: 8) { Text(store.search.isEmpty ? "All caught up" : "No matches yet").font(.headline); Text(store.search.isEmpty ? "New conversations will appear here." : "Try a name, handle, or a phrase from a message.").font(.callout).foregroundStyle(.secondary) }.padding(.vertical, 24).listRowSeparator(.hidden)
                    }
                    ForEach(store.visible) { chat in
                        ConversationRow(chat: chat, selected: store.selectedID == chat.id, draft: store.drafts[chat.id])
                            .tag(chat.id).listRowSeparator(.hidden).padding(.vertical, 4)
                            .contextMenu {
                                Button(chat.pinned ? "Unpin" : "Pin conversation", systemImage: chat.pinned ? "pin.slash" : "pin") { Task { await store.update(chat, body: ["pinned": !chat.pinned]) } }
                                Button(chat.status == "done" ? "Mark open" : "Mark done", systemImage: "checkmark.circle") { Task { await store.update(chat, body: ["status": chat.status == "done" ? "open" : "done"]) } }
                            }
                    }
                    if !store.searchHits.isEmpty {
                        Section("In messages") {
                            ForEach(store.searchHits) { hit in
                                Button {
                                    store.select(hit.conversationId, focus: hit.id)
                                } label: {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(store.conversations.first { $0.id == hit.conversationId }?.name ?? "Conversation").font(.caption.weight(.semibold))
                                        Text(hit.body).font(.callout).lineLimit(3).foregroundStyle(.secondary)
                                    }.padding(.vertical, 8)
                                }.buttonStyle(.plain).listRowSeparator(.hidden)
                            }
                        }
                    }
                    if store.searchBusy { Text("Searching saved messages…").font(.caption).foregroundStyle(.secondary).listRowSeparator(.hidden) }
                }.listStyle(.sidebar).scrollContentBackground(.hidden)
            }
            if let error = store.error { Text(error).font(.caption).foregroundStyle(.secondary).padding(16) }
            HStack(spacing: 8) {
                Button { showConnections.toggle() } label: {
                    HStack(spacing: 8) {
                        Circle().fill(store.online ? Color.green : Color.orange).frame(width: 6, height: 6)
                        Text(store.demo ? "Design preview" : "On this Mac").font(.caption.weight(.medium))
                        Image(systemName: "chevron.up").font(.system(size: 8, weight: .semibold))
                    }
                }.buttonStyle(.plain).help("Connection status").popover(isPresented: $showConnections, arrowEdge: .top) { ConnectionsPopover().environmentObject(store) }
                Spacer()
                Button { showSettings = true } label: { Image(systemName: "gearshape") }.buttonStyle(.plain).help("Settings").accessibilityLabel("Settings")
            }.foregroundStyle(.secondary).padding(20)
        }.background(SidebarMaterial())
        .onChange(of: store.search) { _, _ in store.searchMessages() }
    }
}

struct ConversationRow: View {
    let chat: Conversation
    let selected: Bool
    let draft: String?
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Avatar(chat: chat, size: 44)
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 6) {
                    Text(chat.name).font(.system(size: 13, weight: chat.unread > 0 ? .semibold : .medium)).lineLimit(1)
                    Spacer(minLength: 2)
                    if chat.pinned { Image(systemName: "pin.fill").font(.system(size: 9)).foregroundStyle(.secondary).accessibilityLabel("Pinned") }
                    Text(chat.date, format: .dateTime.hour().minute()).font(.system(size: 10)).foregroundStyle(.secondary).monospacedDigit()
                }
                HStack(alignment: .top) {
                    Text((draft?.isEmpty == false ? "Draft: \(draft!)" : chat.lastMessage) ?? "No messages yet")
                        .font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(2).frame(maxWidth: .infinity, alignment: .leading)
                    if chat.unread > 0 { Text(chat.unread > 99 ? "99+" : "\(chat.unread)").font(.system(size: 10, weight: .semibold)).foregroundStyle(selected ? Color.accentColor : .white).padding(.horizontal, 6).padding(.vertical, 2).background(selected ? Color.white : Color.accentColor, in: Capsule()).accessibilityLabel("\(chat.unread) unread messages") }
                }
            }.padding(.top, 2)
        }.padding(.vertical, 4).accessibilityElement(children: .combine)
    }
}

// Keep image requests on the same ephemeral, redirect-blocking session as chats.
struct LocalPhoto: View {
    @EnvironmentObject var store: InboxStore
    let url: URL
    var avatar = false
    @State private var image: NSImage?
    @State private var failed = false
    var body: some View {
        Group {
            if let image { Image(nsImage: image).resizable().aspectRatio(contentMode: avatar ? .fill : .fit) }
            else if !avatar { Label(failed ? "Photo unavailable" : "Loading photo…", systemImage: "photo").padding(16) }
        }.task(id: url) {
            image = nil; failed = false
            do {
                let (data, response) = try await store.api.session.data(from: url)
                try store.api.validate(response, data)
                guard !Task.isCancelled else { return }
                image = NSImage(data: data); failed = image == nil
            } catch { if !Task.isCancelled { failed = true } }
        }
    }
}

struct Avatar: View {
    @EnvironmentObject var store: InboxStore
    let chat: Conversation
    var size: CGFloat = 40
    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            Circle().fill(Color.accentColor.opacity(0.12))
                .overlay(Text(chat.initials).font(.system(size: size * 0.32, weight: .medium)).foregroundStyle(Color.accentColor))
                .overlay { if let url = store.api.localMediaURL(chat.contact.avatarUrl) { LocalPhoto(url: url, avatar: true).clipShape(Circle()) } }
                .frame(width: size, height: size)
            Text(chat.platform == "x" ? "𝕏" : String(chat.network.prefix(1)))
                .font(.system(size: 9, weight: .semibold)).foregroundStyle(.secondary)
                .frame(width: 16, height: 16).background(.regularMaterial, in: Circle())
                .overlay(Circle().strokeBorder(.background, lineWidth: 1.5))
                .offset(x: 2, y: 2)
        }.accessibilityHidden(true)
    }
}

struct ConversationView: View {
    @EnvironmentObject var store: InboxStore
    let chat: Conversation
    @State private var showingDetails = false
    @State private var atBottom = true
    @State private var showNewMessages = false
    private var timeline: [Message] { projectMessages(store.messages, platform: chat.platform) }
    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Avatar(chat: chat, size: 36)
                VStack(alignment: .leading, spacing: 3) {
                    Text(chat.name).font(.headline)
                    Text(chat.network + (chat.isGroup ? " · Group" : "") + (chat.account?.label.map { " · \($0)" } ?? ""))
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button { store.openWorkspace() } label: { Image(systemName: "arrow.up.right.square") }
                    .buttonStyle(.borderless).help("Open this chat in the full workspace").accessibilityLabel("Open full workspace")
                Button { showingDetails.toggle() } label: { Image(systemName: "info.circle") }
                    .buttonStyle(.borderless).help("Conversation details").accessibilityLabel("Conversation details")
                    .popover(isPresented: $showingDetails) { VStack(alignment: .leading, spacing: 16) { Text(chat.name).font(.headline); Text(chat.contact.handle).textSelection(.enabled); Text(chat.network).foregroundStyle(.secondary); if let email = chat.contact.email { Text(email).textSelection(.enabled) }; Button("More details in workspace") { store.openWorkspace() } }.padding(24).frame(minWidth: 240) }
            }.padding(.horizontal, 24).padding(.top, 36).padding(.bottom, 16).background(.bar)
            if let error = store.chatError { HStack { Text(error); Button("Retry") { Task { await store.refreshMessages(chat.id) } } }.font(.caption).padding(12) }
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 12) {
                        if store.hasMore { Button(store.loadingOlder ? "Loading…" : "Load older messages") { Task { await store.older() } }.buttonStyle(.borderless).disabled(store.loadingOlder).padding(.vertical, 16) }
                        if store.loadingChat { ProgressView("Loading conversation…").padding(40) }
                        if !store.loadingChat && store.messages.isEmpty { Text("No saved messages yet").foregroundStyle(.secondary).padding(40) }
                        ForEach(Array(timeline.enumerated()), id: \.element.id) { index, message in
                            if index == 0 || !Calendar.current.isDate(message.date, inSameDayAs: timeline[index - 1].date) {
                                Text(message.date, format: .dateTime.weekday(.wide).month(.abbreviated).day()).font(.caption.weight(.medium)).foregroundStyle(.tertiary).padding(.vertical, 16)
                            }
                            MessageBubble(message: message, isGroup: chat.isGroup, highlighted: store.focusedMessageID == message.id)
                                .id(message.id)
                        }
                        Color.clear.frame(height: 1).id("bottom").onAppear { atBottom = true; showNewMessages = false }.onDisappear { atBottom = false }
                    }.padding(.horizontal, 32).padding(.vertical, 12).frame(maxWidth: 900).frame(maxWidth: .infinity)
                }
                .overlay(alignment: .bottom) {
                    if showNewMessages { Button { proxy.scrollTo("bottom", anchor: .bottom); showNewMessages = false } label: { Label("New messages", systemImage: "arrow.down") }.buttonStyle(.bordered).background(NativeGlass()).padding(12) }
                }
                .onChange(of: store.focusedMessageID) { _, focus in
                    if let focus { Task { @MainActor in await Task.yield(); proxy.scrollTo(focus, anchor: .center) } }
                }
                .onChange(of: store.messages.last?.id, initial: true) { old, new in
                    if old == nil || old == new || (atBottom && store.focusedMessageID == nil) || store.messages.last?.outgoing == true {
                        Task { @MainActor in
                            await Task.yield()
                            if let focus = store.focusedMessageID { proxy.scrollTo(focus, anchor: .center) }
                            else { proxy.scrollTo("bottom", anchor: .bottom) }
                        }
                    } else if old != new { showNewMessages = true }
                }
            }
            Composer(chat: chat).padding(.horizontal, 24).padding(.top, 8).padding(.bottom, 20)
        }.background(Color(nsColor: .windowBackgroundColor))
    }
}

struct MessageBubble: View {
    @EnvironmentObject var store: InboxStore
    let message: Message
    let isGroup: Bool
    let highlighted: Bool
    var body: some View {
        HStack {
            if message.outgoing { Spacer(minLength: 100) }
            VStack(alignment: message.outgoing ? .trailing : .leading, spacing: 5) {
                if isGroup && !message.outgoing, let name = message.senderName { Text(name).font(.caption.weight(.medium)).foregroundStyle(.secondary).padding(.horizontal, 8) }
                VStack(alignment: .leading, spacing: 8) {
                    if message.preview { Text("Inbox preview · awaiting full message").font(.caption2).foregroundStyle(.secondary) }
                    if let reply = message.replyPreview { VStack(alignment: .leading, spacing: 4) { Text(message.replySender ?? "Reply").font(.caption.weight(.semibold)); Text(reply).font(.caption).lineLimit(2) }.padding(8).frame(maxWidth: .infinity, alignment: .leading).background(.black.opacity(0.06), in: RoundedRectangle(cornerRadius: 8)) }
                    if message.deletedAt != nil { Label("Message deleted", systemImage: "nosign").foregroundStyle(.secondary) }
                    else {
                        if let media = store.api.localMediaURL(message.mediaUrl) {
                            if message.mediaType == "image" || message.mediaType == "sticker" {
                                LocalPhoto(url: media).frame(maxWidth: 320, maxHeight: 280).clipShape(RoundedRectangle(cornerRadius: 12))
                            }
                            Button { NSWorkspace.shared.open(media) } label: { Label(message.mediaName ?? "Open attachment", systemImage: message.mediaType == "audio" ? "waveform" : "arrow.down.doc") }.buttonStyle(.plain).font(.caption)
                        } else if message.mediaType != nil {
                            Button { store.openWorkspace() } label: { Label("Download attachment in workspace", systemImage: "arrow.down.circle") }.buttonStyle(.plain).font(.callout)
                        }
                        if !message.body.isEmpty { Text(message.body).font(.system(size: 14)).textSelection(.enabled).lineSpacing(3).fixedSize(horizontal: false, vertical: true) }
                    }
                }
                .padding(.horizontal, 16).padding(.vertical, 12)
                .foregroundStyle(message.outgoing ? Color.white : Color.primary)
                .background(message.outgoing ? Color.accentColor : Color(nsColor: .quaternaryLabelColor).opacity(0.45), in: RoundedRectangle(cornerRadius: 20))
                .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(highlighted ? Color.accentColor : .clear, lineWidth: 2))
                .contextMenu {
                    Button("Copy text", systemImage: "doc.on.doc") { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(message.body, forType: .string) }
                    if message.deletedAt == nil && !message.preview { Button("Reply", systemImage: "arrowshape.turn.up.left") { if let id = store.selectedID { store.replies[id] = message } } }
                    Button("More actions in workspace", systemImage: "arrow.up.right.square") { store.openWorkspace() }
                }
                HStack(spacing: 4) {
                    Text(message.date, format: .dateTime.hour().minute())
                    if message.editedAt != nil { Text("· Edited") }
                    if message.deliveryStatus == "failed" { Text("· Failed").foregroundStyle(.red) }
                    if message.deliveryStatus == "unconfirmed" { Text("· Delivery unknown").foregroundStyle(.orange) }
                }.font(.system(size: 10)).foregroundStyle(.tertiary).padding(.horizontal, 8)
            }.frame(maxWidth: 520, alignment: message.outgoing ? .trailing : .leading)
            if !message.outgoing { Spacer(minLength: 100) }
        }
    }
}

struct Composer: View {
    @EnvironmentObject var store: InboxStore
    @State private var textWidth: CGFloat = 400
    let chat: Conversation
    private var textHeight: CGFloat {
        let text = store.draft.isEmpty ? " " : store.draft + " "
        let bounds = (text as NSString).boundingRect(with: NSSize(width: max(60, textWidth - 12), height: 10000), options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: [.font: NSFont.systemFont(ofSize: 14)])
        return min(104, max(34, ceil(bounds.height) + 16))
    }
    var body: some View {
        VStack(spacing: 8) {
            if let error = store.currentSendError { HStack(alignment: .top, spacing: 8) { Image(systemName: "exclamationmark.circle"); Text(error).fixedSize(horizontal: false, vertical: true); Button("Review") { store.openWorkspace() } }.font(.caption).foregroundStyle(.secondary) }
            if store.uncertainSends.contains(chat.id) { Button("I checked delivery in the workspace") { store.acknowledgeUncertainSend(chat.id) }.font(.caption).buttonStyle(.borderless) }
            if let reply = store.replies[chat.id] { HStack { Text("Replying to \(reply.senderName ?? chat.name): \(reply.body)").font(.caption).lineLimit(1); Spacer(); Button { store.replies[chat.id] = nil } label: { Image(systemName: "xmark.circle.fill") }.buttonStyle(.plain).accessibilityLabel("Cancel reply") }.padding(.horizontal, 12) }
            if let attachment = store.attachments[chat.id] { HStack { Image(systemName: "doc"); Text(attachment.lastPathComponent).lineLimit(1); Spacer(); Button { store.attachments[chat.id] = nil } label: { Image(systemName: "xmark.circle.fill") }.buttonStyle(.plain).accessibilityLabel("Remove attachment") }.font(.caption).padding(.horizontal, 12) }
            HStack(alignment: .bottom, spacing: 12) {
                Button { store.attachFile() } label: { Image(systemName: "plus").font(.system(size: 18, weight: .medium)).frame(width: 32, height: 32) }.buttonStyle(.borderless).help("Attach a photo or file").accessibilityLabel("Attach a file").disabled(store.sending.contains(chat.id))
                ZStack(alignment: .topLeading) {
                    if store.draft.isEmpty { Text("Message on \(chat.network)").foregroundStyle(.tertiary).padding(.top, 8).padding(.leading, 5).allowsHitTesting(false) }
                    TextEditor(text: Binding(get: { store.draft }, set: { store.draft = $0 })).font(.system(size: 14))
                        .scrollContentBackground(.hidden).frame(height: textHeight).background(GeometryReader { geometry in Color.clear.onAppear { textWidth = geometry.size.width }.onChange(of: geometry.size.width) { _, width in textWidth = width } }).accessibilityLabel("Message on \(chat.network)")
                }
                Button { Task { await store.send() } } label: { Image(systemName: "arrow.up").font(.system(size: 16, weight: .semibold)).foregroundStyle(store.canSend ? .white : Color.secondary).frame(width: 32, height: 32).background(store.canSend ? Color.accentColor : Color.secondary.opacity(0.12), in: Circle()) }
                    .buttonStyle(.plain).disabled(!store.canSend).keyboardShortcut(.return, modifiers: .command).help("Send message (⌘ Return)").accessibilityLabel("Send message")
            }.padding(12).background(NativeGlass(radius: 24))
            HStack {
                if chat.translationEnabled == true { Text("Translating to \(chat.translationLanguageName ?? "selected language")") }
                else { Text(store.demo ? "Preview mode · nothing leaves this app" : "Drafts stay on this Mac") }
                Spacer(); Text("⌘ Return to send")
            }.font(.system(size: 10)).foregroundStyle(.tertiary).padding(.horizontal, 12)
        }.frame(maxWidth: 900).frame(maxWidth: .infinity)
    }
}

struct ConnectionsPopover: View {
    @EnvironmentObject var store: InboxStore
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Connections").font(.headline)
            Text("Using your existing local accounts.").font(.caption).foregroundStyle(.secondary)
            ForEach(store.networks) { network in
                HStack(alignment: .top, spacing: 12) {
                    Circle().fill(network.state == "ready" ? Color.green : Color.orange).frame(width: 6, height: 6).padding(.top, 5)
                    VStack(alignment: .leading, spacing: 4) { Text(network.name).font(.callout.weight(.medium)); if !network.detail.isEmpty { Text(network.detail).font(.caption).foregroundStyle(.secondary) } }
                    Spacer(); Text(network.state == "ready" ? "Connected" : network.state.capitalized).font(.caption).foregroundStyle(.secondary)
                }
            }
            if store.networks.isEmpty { Text("Start the local service to see your accounts.").font(.callout).foregroundStyle(.secondary) }
            Divider()
            Button("Manage connections in workspace") { store.openWorkspace() }
        }.padding(24).frame(width: 340)
    }
}

struct NativeSettings: View {
    @EnvironmentObject var store: InboxStore
    @Environment(\.dismiss) var dismiss
    @AppStorage("appearance") var appearance = "system"
    @State private var address = ""
    @State private var error: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            HStack { Text("2ManyDMs for Mac").font(.title2.weight(.semibold)); Spacer(); Button("Done") { dismiss() }.keyboardShortcut(.cancelAction) }
            Form {
                Picker("Appearance", selection: $appearance) { Text("System").tag("system"); Text("Light").tag("light"); Text("Dark").tag("dark") }.pickerStyle(.segmented)
                LabeledContent("Glass", value: TMDHasLiquidGlass() ? "Liquid Glass" : "Native translucency")
                Section("Local inbox") {
                    TextField("Service address", text: $address)
                    Text("Uses the accounts already connected in your workspace. No second sign-in or extra sync session.").font(.caption).foregroundStyle(.secondary)
                    if let error { Text(error).foregroundStyle(.red).font(.caption) }
                    Button("Connect") { do { try store.reconnect(address: address); dismiss() } catch { self.error = error.localizedDescription } }.disabled(store.demo || !store.sending.isEmpty)
                }
            }.formStyle(.grouped)
            Text("Native preview · Some tools, including account setup, translation controls, and advanced message actions, open in the full workspace.").font(.caption).foregroundStyle(.secondary)
        }.padding(24).frame(width: 480).onAppear { address = store.serviceAddress }
    }
}

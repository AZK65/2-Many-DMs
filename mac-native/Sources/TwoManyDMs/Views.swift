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
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var showConnections = false
    @State private var showSettings = false
    @State private var showDetails = false
    @State private var visibility: NavigationSplitViewVisibility = .all
    @FocusState private var searchFocused: Bool
    private var filterCount: Int { (store.filter == .all ? 0 : 1) + (store.platform == "all" ? 0 : 1) }

    var body: some View {
        NavigationSplitView(columnVisibility: $visibility) {
            sidebar
                .navigationSplitViewColumnWidth(min: 260, ideal: 300, max: 380)
                .toolbar {
                    ToolbarItem(placement: .primaryAction) {
                        Menu {
                            if store.demo { Text("Preview · nothing is sent") }
                            Picker("Inbox", selection: $store.filter) {
                                ForEach(InboxFilter.allCases) { Text($0.rawValue).tag($0) }
                            }
                            Picker("Network", selection: $store.platform) {
                                Text("All networks").tag("all")
                                ForEach(Array(Set(store.conversations.map(\.platform))).sorted(), id: \.self) { item in
                                    Text(item == "x" ? "X" : item == "whatsapp" ? "WhatsApp" : item.capitalized).tag(item)
                                }
                            }
                            if filterCount > 0 { Button("Clear filters") { store.filter = .all; store.platform = "all" } }
                            Divider()
                            Button("Connections", systemImage: "antenna.radiowaves.left.and.right") { showConnections = true }
                            Button("Settings…", systemImage: "gearshape") { showSettings = true }
                            Button("Open full workspace", systemImage: "arrow.up.right.square") { store.openWorkspace() }
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: filterCount == 0 ? "line.3.horizontal.decrease" : "line.3.horizontal.decrease.circle.fill")
                                if filterCount > 0 { Text("\(filterCount)").font(.caption.weight(.semibold)) }
                            }
                        }.help("Filter conversations").accessibilityLabel(filterCount == 0 ? "Inbox options" : "Inbox options, \(filterCount) filters active")
                    }
                }
        } detail: {
            if let chat = store.selected {
                ConversationView(chat: chat, showingDetails: $showDetails).id(chat.id)
            } else {
                VStack(spacing: 12) {
                    Image(systemName: "bubble.left.and.bubble.right").font(.system(size: 40, weight: .ultraLight)).foregroundStyle(.tertiary)
                    Text(store.loading ? "Opening your inbox" : "Your messages, together").font(.title3.weight(.medium))
                    Text(store.online ? "Choose a conversation to get started." : "Connect to your local workspace to see your chats.")
                        .font(.callout).foregroundStyle(.secondary)
                    if !store.online && !store.loading { Button("Retry connection") { Task { await store.refresh() } } }
                }.frame(maxWidth: .infinity, maxHeight: .infinity).background(Color(nsColor: .textBackgroundColor))
            }
        }
        .navigationSplitViewStyle(.balanced)
        .frame(minWidth: 780, minHeight: 500)
        .inspector(isPresented: $showDetails) {
            if let chat = store.selected {
                ConversationDetails(chat: chat) { withAnimation(reduceMotion ? nil : .smooth(duration: 0.28)) { showDetails = false } }
                    .id(chat.id).inspectorColumnWidth(min: 280, ideal: 300, max: 340)
            }
        }
        .sheet(isPresented: $showSettings) { NativeSettings().environmentObject(store) }
        .popover(isPresented: $showConnections) { ConnectionsPopover().environmentObject(store) }
        .onAppear { store.start() }
        .onDisappear { store.flushDrafts() }
        .onReceive(NotificationCenter.default.publisher(for: .init("TwoManyDMs.find"))) { _ in visibility = .all; searchFocused = true }
        .onReceive(NotificationCenter.default.publisher(for: .init("TwoManyDMs.settings"))) { _ in showSettings = true }
        .onReceive(NotificationCenter.default.publisher(for: .init("TwoManyDMs.details"))) { _ in
            if store.selected != nil { withAnimation(reduceMotion ? nil : .smooth(duration: 0.28)) { showDetails.toggle() } }
        }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.willTerminateNotification)) { _ in store.flushDrafts() }
    }
    private var sidebar: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").font(.system(size: 12)).foregroundStyle(.secondary)
                TextField("Search", text: $store.search).textFieldStyle(.plain).focused($searchFocused)
                    .accessibilityLabel("Search chats and messages")
                if !store.search.isEmpty {
                    Button { store.search = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary) }
                        .buttonStyle(.plain).help("Clear search").accessibilityLabel("Clear search")
                }
            }.padding(.horizontal, 12).padding(.vertical, 8)
                .background(.quaternary.opacity(0.4), in: Capsule()).padding(.horizontal, 12).padding(.top, 8).padding(.bottom, 8)
            if store.loading {
                VStack(spacing: 24) {
                    ForEach(0..<6) { _ in
                        HStack(spacing: 12) {
                            Circle().fill(.quaternary).frame(width: 40, height: 40)
                            VStack(alignment: .leading, spacing: 8) { Capsule().fill(.quaternary).frame(width: 100, height: 10); Capsule().fill(.quaternary).frame(height: 8) }
                        }
                    }
                }.padding(24).accessibilityLabel("Loading conversations")
                Spacer()
            } else {
                List(selection: Binding(get: { store.selectedID }, set: { store.select($0) })) {
                    if store.visible.isEmpty && store.searchHits.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(store.search.isEmpty ? "All caught up" : "No matches").font(.headline)
                            Text(store.search.isEmpty ? "New chats will appear here." : "Try a name or a phrase from a message.").font(.callout).foregroundStyle(.secondary)
                        }.padding(.vertical, 24).listRowSeparator(.hidden)
                    }
                    ForEach(store.visible) { chat in
                        ConversationRow(chat: chat, selected: store.selectedID == chat.id, draft: store.drafts[chat.id])
                            .tag(chat.id).listRowSeparator(.hidden)
                            .listRowInsets(EdgeInsets(top: 0, leading: 4, bottom: 0, trailing: 4))
                            .contextMenu {
                                Button(chat.pinned ? "Unpin" : "Pin conversation", systemImage: chat.pinned ? "pin.slash" : "pin") { Task { await store.update(chat, body: ["pinned": !chat.pinned]) } }
                                Button(chat.status == "done" ? "Mark open" : "Mark done", systemImage: "checkmark.circle") { Task { await store.update(chat, body: ["status": chat.status == "done" ? "open" : "done"]) } }
                            }
                    }
                    if !store.searchHits.isEmpty {
                        Section("Messages") {
                            ForEach(store.searchHits) { hit in
                                Button { store.select(hit.conversationId, focus: hit.id) } label: {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(store.conversations.first { $0.id == hit.conversationId }?.name ?? "Conversation").font(.callout.weight(.medium))
                                        Text(hit.body).font(.callout).lineLimit(2).foregroundStyle(.secondary)
                                    }.padding(.vertical, 8)
                                }.buttonStyle(.plain).listRowSeparator(.hidden)
                            }
                        }
                    }
                    if store.searchBusy { Text("Searching messages…").font(.caption).foregroundStyle(.secondary).listRowSeparator(.hidden) }
                }.listStyle(.sidebar).scrollContentBackground(.hidden)
            }
            if let error = store.error { Text(error).font(.caption).foregroundStyle(.secondary).padding(12) }
        }.background(SidebarMaterial())
            .onChange(of: store.search) { _, _ in store.searchMessages() }
    }
}

struct ConversationRow: View {
    let chat: Conversation
    let selected: Bool
    let draft: String?
    private var dateLabel: String {
        if Calendar.current.isDateInToday(chat.date) { return chat.date.formatted(.dateTime.hour().minute()) }
        if Calendar.current.isDateInYesterday(chat.date) { return "Yesterday" }
        return chat.date.formatted(.dateTime.month(.abbreviated).day())
    }
    var body: some View {
        HStack(spacing: 8) {
            Circle().fill(chat.unread > 0 ? Color.accentColor : .clear).frame(width: 6, height: 6)
                .accessibilityLabel(chat.unread > 0 ? "\(chat.unread) unread messages" : "Read")
            Avatar(chat: chat, size: 40)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 4) {
                    Text(chat.name).font(.system(size: 13, weight: .semibold)).lineLimit(1)
                    Spacer(minLength: 2)
                    if chat.pinned { Image(systemName: "pin.fill").font(.system(size: 9)).foregroundStyle(.secondary).accessibilityLabel("Pinned") }
                    Text(dateLabel).font(.system(size: 11)).foregroundStyle(.secondary).monospacedDigit()
                }
                Text((draft?.isEmpty == false ? "Draft: \(draft!)" : chat.lastMessage) ?? "No messages yet")
                    .font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(2).frame(maxWidth: .infinity, alignment: .leading)
            }
        }.padding(.vertical, 12).padding(.trailing, 8)
            .contentShape(Rectangle()).accessibilityElement(children: .combine)
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
    var showNetwork = true
    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            Circle().fill(Color(nsColor: .tertiaryLabelColor).opacity(0.2))
                .overlay(Text(chat.initials).font(.system(size: size * 0.32, weight: .medium)).foregroundStyle(.primary))
                .overlay { if let url = store.api.localMediaURL(chat.contact.avatarUrl) { LocalPhoto(url: url, avatar: true).clipShape(Circle()) } }
                .frame(width: size, height: size)
            if showNetwork { Text(chat.platform == "x" ? "𝕏" : String(chat.network.prefix(1)))
                .font(.system(size: 9, weight: .semibold)).foregroundStyle(.secondary)
                .frame(width: 16, height: 16).background(.regularMaterial, in: Circle())
                .overlay(Circle().strokeBorder(.background, lineWidth: 1.5))
                .offset(x: 2, y: 2) }
        }.accessibilityHidden(true)
    }
}

struct TimelineBottomKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

struct ConversationView: View {
    @EnvironmentObject var store: InboxStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let chat: Conversation
    @Binding var showingDetails: Bool
    @State private var atBottom = true
    @State private var showNewMessages = false
    @State private var initialPositioned = false
    private var motion: Animation? { reduceMotion ? nil : .smooth(duration: 0.24) }

    var body: some View {
        let items = projectMessages(store.messages, platform: chat.platform)
        VStack(spacing: 0) {
            if let error = store.chatError {
                HStack { Text(error); Button("Retry") { Task { await store.refreshMessages(chat.id) } } }.font(.caption).padding(12)
            }
            GeometryReader { viewport in
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 4) {
                            if store.hasMore {
                                Button(store.loadingOlder ? "Loading…" : "Load earlier messages") {
                                    let anchor = store.messages.first?.id
                                    Task {
                                        await store.older()
                                        if let anchor { proxy.scrollTo(anchor, anchor: .top) }
                                    }
                                }.buttonStyle(.borderless).font(.caption).disabled(store.loadingOlder).padding(.vertical, 12)
                            }
                            if store.loadingChat && store.messages.isEmpty { ProgressView().controlSize(.small).padding(24) }
                            if !store.loadingChat && store.messages.isEmpty { Text("No messages yet").font(.callout).foregroundStyle(.secondary).padding(24) }
                            ForEach(Array(items.enumerated()), id: \.element.id) { index, message in
                                let previous = index > 0 ? items[index - 1] : nil
                                let next = index + 1 < items.count ? items[index + 1] : nil
                                let firstInGroup = previous.map { !messagesAreGrouped($0, message) } ?? true
                                let lastInGroup = next.map { !messagesAreGrouped(message, $0) } ?? true
                                if previous == nil || !Calendar.current.isDate(message.date, inSameDayAs: previous!.date) || message.date.timeIntervalSince(previous!.date) > 3600 {
                                    Text(message.date.formatted(.dateTime.month(.abbreviated).day().hour().minute()))
                                        .font(.system(size: 11, weight: .medium)).foregroundStyle(.secondary).padding(.vertical, 12)
                                }
                                MessageBubble(message: message, isGroup: chat.isGroup, highlighted: store.focusedMessageID == message.id,
                                              firstInGroup: firstInGroup, lastInGroup: lastInGroup,
                                              latestOutgoing: message.id == items.last?.id)
                                    .padding(.top, firstInGroup && index > 0 ? 4 : 0)
                                    .id(message.id)
                                    .transition(.asymmetric(insertion: .offset(y: 8).combined(with: .opacity), removal: .opacity))
                            }
                            Color.clear.frame(height: 1).id("bottom")
                                .background(GeometryReader { position in Color.clear.preference(key: TimelineBottomKey.self, value: position.frame(in: .named("transcript")).maxY) })
                        }.padding(.horizontal, 24).padding(.top, 8).padding(.bottom, 12)
                            .frame(maxWidth: 1000).frame(maxWidth: .infinity)
                            .frame(minHeight: max(0, viewport.size.height), alignment: .bottom)
                            .animation(initialPositioned && !store.loadingOlder ? motion : nil, value: store.messages.last?.id)
                    }
                    .coordinateSpace(name: "transcript")
                    .onPreferenceChange(TimelineBottomKey.self) { bottom in
                        atBottom = bottom <= viewport.size.height + 48
                        if atBottom { showNewMessages = false }
                    }
                    .overlay(alignment: .bottom) {
                        if showNewMessages {
                            Button { withAnimation(motion) { proxy.scrollTo("bottom", anchor: .bottom) }; showNewMessages = false }
                                label: { Label("New messages", systemImage: "arrow.down") }
                                .buttonStyle(.bordered).background(NativeGlass()).padding(12)
                        }
                    }
                    .onChange(of: store.focusedMessageID) { _, focus in
                        if let focus { Task { @MainActor in await Task.yield(); proxy.scrollTo(focus, anchor: .center) } }
                    }
                    .onChange(of: store.messages.last?.id, initial: true) { old, new in
                        guard new != nil else { return }
                        let first = !initialPositioned
                        initialPositioned = true
                        if first || atBottom || store.messages.last?.outgoing == true {
                            Task { @MainActor in
                                await Task.yield()
                                if let focus = store.focusedMessageID { proxy.scrollTo(focus, anchor: .center) }
                                else { withAnimation(first ? nil : motion) { proxy.scrollTo("bottom", anchor: .bottom) } }
                            }
                        } else if old != new { showNewMessages = true }
                    }
                }
            }
            Composer(chat: chat).padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 12)
        }
        .background(Color(nsColor: .textBackgroundColor))
        .toolbar {
            ToolbarItem(placement: .principal) {
                Button { withAnimation(motion) { showingDetails.toggle() } } label: {
                    HStack(spacing: 8) {
                        Avatar(chat: chat, size: 28, showNetwork: false)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(chat.name).font(.system(size: 13, weight: .semibold)).lineLimit(1)
                            Text(chat.network + (chat.isGroup ? " · Group" : "")).font(.system(size: 10)).foregroundStyle(.secondary)
                        }
                        Image(systemName: "chevron.right").font(.system(size: 9)).foregroundStyle(.secondary)
                            .rotationEffect(.degrees(showingDetails ? 90 : 0))
                    }
                }.buttonStyle(.plain).help("Conversation details (⌘I)")
                    .accessibilityLabel("\(showingDetails ? "Hide" : "Show") details for \(chat.name)")
            }
            ToolbarItem(placement: .primaryAction) {
                Button { store.openWorkspace() } label: { Image(systemName: "arrow.up.right.square") }
                    .help("Open full workspace").accessibilityLabel("Open full workspace")
            }
        }
    }
}

struct MessageBubble: View {
    @EnvironmentObject var store: InboxStore
    let message: Message
    let isGroup: Bool
    let highlighted: Bool
    let firstInGroup: Bool
    let lastInGroup: Bool
    let latestOutgoing: Bool
    private var shape: UnevenRoundedRectangle {
        UnevenRoundedRectangle(topLeadingRadius: 18, bottomLeadingRadius: !message.outgoing && lastInGroup ? 4 : 18,
                               bottomTrailingRadius: message.outgoing && lastInGroup ? 4 : 18, topTrailingRadius: 18)
    }
    var body: some View {
        HStack(alignment: .bottom, spacing: 0) {
            if message.outgoing { Spacer(minLength: 64) }
            VStack(alignment: message.outgoing ? .trailing : .leading, spacing: 4) {
                if isGroup && !message.outgoing && firstInGroup, let name = message.senderName {
                    Text(name).font(.caption).foregroundStyle(.secondary).padding(.horizontal, 12)
                }
                VStack(alignment: .leading, spacing: 8) {
                    if message.preview { Text("Preview · syncing full message").font(.caption2).foregroundStyle(.secondary) }
                    if let reply = message.replyPreview {
                        VStack(alignment: .leading, spacing: 4) { Text(message.replySender ?? "Reply").font(.caption.weight(.medium)); Text(reply).font(.caption).lineLimit(2) }
                            .padding(8).background(.black.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
                    }
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
                        if !message.body.isEmpty { Text(message.body).font(.system(size: 16)).textSelection(.enabled).fixedSize(horizontal: false, vertical: true) }
                    }
                }
                .padding(.horizontal, 12).padding(.vertical, 8)
                .foregroundStyle(message.outgoing ? Color.white : Color.primary)
                .background(message.outgoing ? Color(nsColor: .systemBlue) : Color(nsColor: .quaternaryLabelColor).opacity(0.9), in: shape)
                .overlay(shape.strokeBorder(highlighted ? Color.accentColor : .clear, lineWidth: 2))
                .help(message.date.formatted(date: .abbreviated, time: .shortened))
                .contextMenu {
                    Button("Copy text", systemImage: "doc.on.doc") { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(message.body, forType: .string) }
                    if message.deletedAt == nil && !message.preview {
                        Button("Reply", systemImage: "arrowshape.turn.up.left") { if let id = store.selectedID { store.replies[id] = message } }
                    }
                    Button("More actions in workspace", systemImage: "arrow.up.right.square") { store.openWorkspace() }
                }
                if message.deliveryStatus == "failed" { Text("Not delivered").font(.caption2).foregroundStyle(.red).padding(.horizontal, 8) }
                else if message.deliveryStatus == "unconfirmed" { Text("Delivery unknown").font(.caption2).foregroundStyle(.orange).padding(.horizontal, 8) }
                else if latestOutgoing && message.deliveryStatus == "sent" { Text("Sent").font(.caption2).foregroundStyle(.secondary).padding(.horizontal, 8) }
                else if message.editedAt != nil { Text("Edited").font(.caption2).foregroundStyle(.secondary).padding(.horizontal, 8) }
            }.frame(maxWidth: 480, alignment: message.outgoing ? .trailing : .leading)
            if !message.outgoing { Spacer(minLength: 64) }
        }
    }
}

struct Composer: View {
    @EnvironmentObject var store: InboxStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var textWidth: CGFloat = 400
    let chat: Conversation
    private var textHeight: CGFloat {
        let text = store.draft.isEmpty ? " " : store.draft + " "
        let bounds = (text as NSString).boundingRect(with: NSSize(width: max(60, textWidth - 16), height: 10000), options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: [.font: NSFont.systemFont(ofSize: 16)])
        return min(112, max(32, ceil(bounds.height) + 14))
    }
    var body: some View {
        VStack(spacing: 8) {
            if let error = store.currentSendError {
                HStack(alignment: .top, spacing: 8) { Image(systemName: "exclamationmark.circle"); Text(error).fixedSize(horizontal: false, vertical: true); Button("Review") { store.openWorkspace() } }.font(.caption).foregroundStyle(.secondary)
            }
            if store.uncertainSends.contains(chat.id) { Button("I checked delivery in the workspace") { store.acknowledgeUncertainSend(chat.id) }.font(.caption).buttonStyle(.borderless) }
            if let reply = store.replies[chat.id] {
                HStack { Text("Reply to \(reply.senderName ?? chat.name): \(reply.body)").font(.caption).lineLimit(1); Spacer(); Button { store.replies[chat.id] = nil } label: { Image(systemName: "xmark.circle.fill") }.buttonStyle(.plain).accessibilityLabel("Cancel reply") }.padding(.horizontal, 12)
            }
            if let attachment = store.attachments[chat.id] {
                HStack { Image(systemName: "doc"); Text(attachment.lastPathComponent).lineLimit(1); Spacer(); Button { store.attachments[chat.id] = nil } label: { Image(systemName: "xmark.circle.fill") }.buttonStyle(.plain).accessibilityLabel("Remove attachment") }.font(.caption).padding(.horizontal, 12)
            }
            HStack(alignment: .bottom, spacing: 8) {
                Button { store.attachFile() } label: { Image(systemName: "plus").font(.system(size: 18)).frame(width: 32, height: 32) }
                    .buttonStyle(.plain).background(NativeGlass(radius: 16)).help("Attach a photo or file").accessibilityLabel("Attach a file").disabled(store.sending.contains(chat.id))
                HStack(alignment: .bottom, spacing: 4) {
                    ZStack(alignment: .topLeading) {
                        if store.draft.isEmpty { Text(chat.translationEnabled == true ? "Message · translating" : "Message").font(.system(size: 16)).foregroundStyle(.secondary).padding(.top, 7).padding(.leading, 8).allowsHitTesting(false) }
                        NativeComposerEditor(text: Binding(get: { store.draft }, set: { store.draft = $0 }), label: "Message on \(chat.network)", send: { Task { await store.send() } })
                            .frame(height: textHeight)
                            .background(GeometryReader { geometry in Color.clear.onAppear { textWidth = geometry.size.width }.onChange(of: geometry.size.width) { _, width in textWidth = width } })
                    }
                    Button { Task { await store.send() } } label: {
                        Image(systemName: "arrow.up").font(.system(size: 13, weight: .semibold)).foregroundStyle(store.canSend ? .white : Color.secondary)
                            .frame(width: 24, height: 24).background(store.canSend ? Color(nsColor: .systemBlue) : .clear, in: Circle())
                    }.buttonStyle(.plain).disabled(!store.canSend).keyboardShortcut(.return, modifiers: .command)
                        .help("Send (Return). Shift Return adds a line.").accessibilityLabel("Send message").padding(4)
                }.padding(.horizontal, 4).background(NativeGlass(radius: 18))
            }
            if chat.translationEnabled == true { Text("Translating to \(chat.translationLanguageName ?? "selected language")").font(.caption2).foregroundStyle(.secondary) }
        }
        .animation(reduceMotion ? nil : .smooth(duration: 0.2), value: textHeight)
        .frame(maxWidth: 1000).frame(maxWidth: .infinity)
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

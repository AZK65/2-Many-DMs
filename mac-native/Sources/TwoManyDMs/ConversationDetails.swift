import SwiftUI
import AppKit

private enum DetailsTab: String, CaseIterable { case info = "Info", photos = "Photos", links = "Links", files = "Files" }

struct ConversationDetails: View {
    @EnvironmentObject var store: InboxStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let chat: Conversation
    let close: () -> Void
    @State private var tab: DetailsTab = .info
    @State private var content: SharedContent?
    @State private var loading = true
    @State private var loadError: String?
    @State private var actionError: String?
    @State private var updating = false
    @State private var copied: String?
    @State private var photo: Message?
    @Namespace private var tabSelection
    private var motion: Animation? { reduceMotion ? nil : .smooth(duration: 0.24) }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button(action: close) { Image(systemName: "xmark").frame(width: 28, height: 28) }
                    .buttonStyle(.borderless).help("Close details").accessibilityLabel("Close details")
                Spacer()
            }.padding(.horizontal, 12).padding(.top, 8)
            ScrollView {
                VStack(spacing: 20) {
                    VStack(spacing: 8) {
                        Avatar(chat: chat, size: 68, showNetwork: false)
                        Text(chat.name).font(.system(size: 22, weight: .semibold)).multilineTextAlignment(.center).textSelection(.enabled)
                        Text(chat.network + (chat.isGroup ? " · Group" : "")).font(.callout).foregroundStyle(.secondary)
                        HStack(spacing: 18) {
                            quickAction("Message", icon: "bubble.left.fill", action: close)
                            quickAction("Copy contact", icon: copied == "contact" ? "checkmark" : "doc.on.doc") {
                                copy(([chat.name, chat.contact.handle] + [chat.contact.email, chat.contact.phone, chat.contact.company].compactMap { $0 }).joined(separator: "\n"), key: "contact")
                            }
                            quickAction("Workspace", icon: "arrow.up.right.square") { store.openWorkspace() }
                        }.padding(.top, 8)
                    }.padding(.horizontal, 12)
                    HStack(spacing: 2) {
                        ForEach(DetailsTab.allCases, id: \.self) { item in
                            Button { withAnimation(motion) { tab = item } } label: {
                                Text(item.rawValue).font(.system(size: 12, weight: tab == item ? .semibold : .regular))
                                    .foregroundStyle(tab == item ? .primary : .secondary)
                                    .frame(maxWidth: .infinity).padding(.vertical, 7)
                                    .background { if tab == item { Capsule().fill(.quaternary).matchedGeometryEffect(id: "tab", in: tabSelection) } }
                            }.buttonStyle(.plain).accessibilityLabel("Details \(item.rawValue)")
                                .accessibilityAddTraits(tab == item ? .isSelected : [])
                        }
                    }
                    Group {
                        switch tab {
                        case .info: info
                        case .photos: sharedPhotos
                        case .links: sharedLinks
                        case .files: sharedFiles
                        }
                    }.id(tab).transition(.opacity)
                }.padding(.horizontal, 16).padding(.bottom, 24)
            }
        }
        .background(.regularMaterial)
        .task(id: chat.id + "|" + (store.messages.last?.id ?? "")) { await load() }
        .onExitCommand(perform: close)
        .sheet(item: $photo) { item in
            VStack(spacing: 16) {
                HStack { Text(item.mediaName ?? "Photo").font(.headline); Spacer(); Button("Done") { photo = nil }.keyboardShortcut(.cancelAction) }
                SharedPhotoContent(message: item).frame(maxWidth: .infinity, maxHeight: .infinity)
                Text(item.date.formatted(date: .abbreviated, time: .shortened)).font(.caption).foregroundStyle(.secondary)
            }.padding(24).frame(minWidth: 500, idealWidth: 660, minHeight: 420, idealHeight: 560)
        }
    }

    private func quickAction(_ name: String, icon: String, action: @escaping () -> Void) -> some View {
        VStack(spacing: 5) {
            Button(action: action) { Image(systemName: icon).font(.system(size: 15)).frame(width: 36, height: 36) }
                .buttonStyle(.borderless).background(NativeGlass(radius: 18)).help(name).accessibilityLabel(name)
            Text(name).font(.system(size: 10)).foregroundStyle(.secondary)
        }
    }
    private var info: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(spacing: 0) {
                contactRow("Handle", value: chat.contact.handle)
                if let email = chat.contact.email, !email.isEmpty { Divider(); contactRow("Email", value: email) }
                if let phone = chat.contact.phone, !phone.isEmpty { Divider(); contactRow("Phone", value: phone) }
                if let company = chat.contact.company, !company.isEmpty { Divider(); contactRow("Company", value: company) }
            }.padding(12).background(.quaternary.opacity(0.55), in: RoundedRectangle(cornerRadius: 14))
            VStack(spacing: 12) {
                HStack {
                    Text("Pin conversation"); Spacer()
                    Toggle("Pin conversation", isOn: Binding(get: { chat.pinned }, set: { update(["pinned": $0]) })).labelsHidden()
                }
                Divider()
                HStack {
                    Text("Mark as done"); Spacer()
                    Toggle("Mark as done", isOn: Binding(get: { chat.status == "done" }, set: { update(["status": $0 ? "done" : "open"]) })).labelsHidden()
                }
            }.toggleStyle(.switch).controlSize(.small).font(.callout).disabled(updating)
                .padding(12).background(.quaternary.opacity(0.55), in: RoundedRectangle(cornerRadius: 14))
            if updating { ProgressView("Saving…").controlSize(.small).font(.caption) }
            if let actionError { Text(actionError).font(.caption).foregroundStyle(.red) }
            Button { store.openWorkspace() } label: {
                HStack {
                    Text("Automatically translate")
                    Spacer()
                    Text(chat.translationEnabled == true ? (chat.translationLanguageName ?? "On") : "Off").foregroundStyle(.secondary)
                    Image(systemName: "arrow.up.right").font(.caption2).foregroundStyle(.secondary)
                }.font(.callout).padding(12).background(.quaternary.opacity(0.55), in: RoundedRectangle(cornerRadius: 14))
            }.buttonStyle(.plain).help("Change translation in the full workspace")
            if chat.isGroup { Button("Manage group in workspace", systemImage: "person.2") { store.openWorkspace() }.buttonStyle(.borderless) }
            if let account = chat.account?.label, !account.isEmpty { Text("Connected through \(account)").font(.caption).foregroundStyle(.secondary) }
            if let pins = content?.pinned.filter({ $0.deletedAt == nil }), !pins.isEmpty {
                Text("Pinned messages").font(.headline)
                ForEach(pins.prefix(6)) { message in
                    Button { store.select(chat.id, focus: message.id); close() } label: {
                        Label(message.body.isEmpty ? "Attachment" : message.body, systemImage: "pin.fill").font(.callout).lineLimit(3).frame(maxWidth: .infinity, alignment: .leading)
                    }.buttonStyle(.borderless)
                }
            }
        }
    }
    private func contactRow(_ label: String, value: String) -> some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 3) {
                Text(label).font(.caption2).foregroundStyle(.secondary)
                Text(value).font(.callout).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            Button { copy(value, key: label) } label: { Image(systemName: copied == label ? "checkmark" : "doc.on.doc") }
                .buttonStyle(.borderless).help(copied == label ? "Copied" : "Copy \(label.lowercased())").accessibilityLabel("Copy \(label.lowercased())")
        }.padding(.vertical, 6)
    }
    private var sharedPhotos: some View {
        VStack(spacing: 12) {
            sharedState(empty: content?.photos.isEmpty != false, title: "No saved photos", icon: "photo.on.rectangle")
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                ForEach(content?.photos ?? []) { item in
                    Button { photo = item } label: {
                        SharedPhotoContent(message: item).frame(height: 112).frame(maxWidth: .infinity)
                            .background(.quaternary).clipShape(RoundedRectangle(cornerRadius: 10))
                    }.buttonStyle(.plain).help(item.mediaName ?? "Open photo").accessibilityLabel(item.mediaName ?? "Open shared photo")
                }
            }
            if content?.photos.isEmpty == false { savedHistoryNote }
        }
    }
    private var sharedLinks: some View {
        VStack(spacing: 12) {
            sharedState(empty: content?.links.isEmpty != false, title: "No saved links", icon: "link")
            ForEach(content?.links ?? []) { link in
                if let url = link.safeURL {
                    Link(destination: url) {
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: "link").foregroundStyle(.secondary).frame(width: 28, height: 28)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(url.host ?? "Link").font(.callout.weight(.medium)).foregroundStyle(.primary)
                                Text(link.url).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                            }
                            Spacer(minLength: 0)
                            Image(systemName: "arrow.up.right").font(.caption).foregroundStyle(.secondary)
                        }.padding(12).frame(maxWidth: .infinity, alignment: .leading)
                            .background(.quaternary.opacity(0.55), in: RoundedRectangle(cornerRadius: 12))
                    }.buttonStyle(.plain)
                }
            }
            if content?.links.isEmpty == false { savedHistoryNote }
        }
    }
    private var sharedFiles: some View {
        VStack(spacing: 12) {
            sharedState(empty: content?.files.isEmpty != false, title: "No saved files", icon: "doc")
            ForEach(content?.files ?? []) { item in
                Button {
                    if let url = store.api.localMediaURL(item.mediaUrl) { NSWorkspace.shared.open(url) }
                    else { store.openWorkspace() }
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: item.mediaType == "audio" ? "waveform" : "doc.fill").font(.title2).foregroundStyle(.secondary)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(item.mediaName ?? "Attachment").font(.callout).lineLimit(2)
                            Text(item.date.formatted(date: .abbreviated, time: .omitted)).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 0)
                        Image(systemName: "arrow.up.right").font(.caption).foregroundStyle(.secondary)
                    }.padding(12).background(.quaternary.opacity(0.55), in: RoundedRectangle(cornerRadius: 12))
                }.buttonStyle(.plain)
            }
            if content?.files.isEmpty == false { savedHistoryNote }
        }
    }
    @ViewBuilder private func sharedState(empty: Bool, title: String, icon: String) -> some View {
        if loading { ProgressView("Loading saved items…").font(.caption).padding(.vertical, 32) }
        else if let loadError {
            VStack(spacing: 12) { Text(loadError).font(.callout).foregroundStyle(.secondary); Button("Try again") { Task { await load() } } }.padding(.vertical, 24)
        } else if empty {
            VStack(spacing: 12) {
                Image(systemName: icon).font(.system(size: 28, weight: .light)).foregroundStyle(.tertiary)
                Text(title).font(.callout.weight(.medium))
                savedHistoryNote
            }.padding(.vertical, 32)
        }
    }
    private var savedHistoryNote: some View { Text("Recent items saved in this chat. Older items appear as history is restored.").font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center) }
    private func copy(_ text: String, key: String) {
        NSPasteboard.general.clearContents(); NSPasteboard.general.setString(text, forType: .string)
        withAnimation(motion) { copied = key }
    }
    private func update(_ body: [String: Any]) {
        updating = true; actionError = nil
        Task {
            if !(await store.update(chat, body: body)) { actionError = store.error ?? "Could not save. Please try again." }
            updating = false
        }
    }
    private func load() async {
        loading = content == nil; loadError = nil
        do {
            let result: SharedContent = store.demo ? DemoData.shared : try await store.api.get("api/conversations/\(chat.id)/shared")
            guard !Task.isCancelled else { return }
            content = result; loading = false
        } catch { if !Task.isCancelled { loadError = "Shared items could not load. Your chat is still available."; loading = false } }
    }
}

private struct SharedPhotoContent: View {
    @EnvironmentObject var store: InboxStore
    let message: Message
    var body: some View {
        if store.demo {
            ZStack {
                LinearGradient(colors: [.indigo.opacity(0.5), .cyan.opacity(0.2)], startPoint: .top, endPoint: .bottom)
                Image(systemName: "mountain.2.fill").font(.system(size: 54)).foregroundStyle(.white.opacity(0.8))
            }.accessibilityLabel("Sample landscape")
        } else if let url = store.api.localMediaURL(message.mediaUrl) { LocalPhoto(url: url) }
        else {
            VStack(spacing: 8) { Image(systemName: "photo"); Text("Photo not downloaded").font(.caption); Button("Open in workspace") { store.openWorkspace() }.font(.caption) }
        }
    }
}

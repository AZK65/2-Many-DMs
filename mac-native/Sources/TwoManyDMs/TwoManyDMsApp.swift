import SwiftUI
import AppKit

@main struct TwoManyDMsApp: App {
    @StateObject private var store = InboxStore()
    @AppStorage("appearance") private var appearance = "system"
    var body: some Scene {
        WindowGroup(store.demo ? "2ManyDMs Preview" : "2ManyDMs") {
            InboxView().environmentObject(store)
                .preferredColorScheme(appearance == "dark" ? .dark : appearance == "light" ? .light : nil)
        }
        .windowStyle(.titleBar)
        .windowToolbarStyle(.unifiedCompact)
        .defaultSize(width: 1080, height: 720)
        .commands {
            CommandGroup(replacing: .newItem) {}
            CommandGroup(replacing: .appSettings) {
                Button("Settings…") { NotificationCenter.default.post(name: .init("TwoManyDMs.settings"), object: nil) }.keyboardShortcut(",", modifiers: .command)
            }
            CommandGroup(after: .textEditing) {
                Button("Find chats and messages") { NotificationCenter.default.post(name: .init("TwoManyDMs.find"), object: nil) }.keyboardShortcut("f", modifiers: .command)
            }
            CommandMenu("Conversation") {
                Button("Show or hide details") { NotificationCenter.default.post(name: .init("TwoManyDMs.details"), object: nil) }.keyboardShortcut("i", modifiers: .command)
                Button("Refresh inbox") { Task { await store.refresh() } }.keyboardShortcut("r", modifiers: .command)
                Button("Open in full workspace") { store.openWorkspace() }.keyboardShortcut("o", modifiers: [.command, .shift])
            }
        }
    }
}

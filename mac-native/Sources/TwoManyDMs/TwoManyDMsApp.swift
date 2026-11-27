import SwiftUI
import AppKit

@main struct TwoManyDMsApp: App {
    @StateObject private var store = InboxStore()
    @AppStorage("appearance") private var appearance = "system"
    var body: some Scene {
        WindowGroup("2ManyDMs") {
            InboxView().environmentObject(store)
                .preferredColorScheme(appearance == "dark" ? .dark : appearance == "light" ? .light : nil)
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 1180, height: 780)
        .commands {
            CommandGroup(replacing: .newItem) {}
            CommandGroup(replacing: .appSettings) {
                Button("Settings…") { NotificationCenter.default.post(name: .init("TwoManyDMs.settings"), object: nil) }.keyboardShortcut(",", modifiers: .command)
            }
            CommandGroup(after: .textEditing) {
                Button("Find chats and messages") { NotificationCenter.default.post(name: .init("TwoManyDMs.find"), object: nil) }.keyboardShortcut("f", modifiers: .command)
            }
            CommandMenu("Conversation") {
                Button("Refresh inbox") { Task { await store.refresh() } }.keyboardShortcut("r", modifiers: .command)
                Button("Open in full workspace") { store.openWorkspace() }.keyboardShortcut("o", modifiers: [.command, .shift])
            }
        }
    }
}

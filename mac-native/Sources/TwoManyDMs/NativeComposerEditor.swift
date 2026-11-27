import AppKit
import SwiftUI

// Keep selection, IME composition, undo, spellchecking and scrolling in AppKit.
// SwiftUI's TextEditor recreated too much of the field during inbox refreshes.
struct NativeComposerEditor: NSViewRepresentable {
    @Binding var text: String
    let label: String
    let send: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeNSView(context: Context) -> NSScrollView {
        let scroll = NSScrollView()
        scroll.drawsBackground = false
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        scroll.borderType = .noBorder
        let editor = MessageTextView()
        editor.delegate = context.coordinator
        editor.send = send
        editor.isRichText = false
        editor.allowsUndo = true
        editor.drawsBackground = false
        editor.font = .systemFont(ofSize: 16)
        editor.textColor = .labelColor
        editor.insertionPointColor = .controlAccentColor
        editor.textContainerInset = NSSize(width: 4, height: 7)
        editor.isVerticallyResizable = true
        editor.isHorizontallyResizable = false
        editor.autoresizingMask = [.width]
        editor.textContainer?.widthTracksTextView = true
        editor.isAutomaticSpellingCorrectionEnabled = true
        editor.setAccessibilityLabel(label)
        scroll.documentView = editor
        return scroll
    }
    func updateNSView(_ scroll: NSScrollView, context: Context) {
        guard let editor = scroll.documentView as? MessageTextView else { return }
        context.coordinator.parent = self
        editor.send = send
        editor.setAccessibilityLabel(label)
        // Never replace text during IME composition or reset the caret for a poll.
        if editor.string != text && !editor.hasMarkedText() {
            let selection = editor.selectedRange()
            editor.string = text
            editor.setSelectedRange(NSRange(location: min(selection.location, (text as NSString).length), length: 0))
        }
    }
    final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: NativeComposerEditor
        init(_ parent: NativeComposerEditor) { self.parent = parent }
        func textDidChange(_ notification: Notification) {
            if let editor = notification.object as? NSTextView { parent.text = editor.string }
        }
    }
}
final class MessageTextView: NSTextView {
    var send: (() -> Void)?
    override func keyDown(with event: NSEvent) {
        if (event.keyCode == 36 || event.keyCode == 76), !hasMarkedText(),
           !event.modifierFlags.contains(.shift), !event.modifierFlags.contains(.option) {
            send?()
        } else { super.keyDown(with: event) }
    }
}

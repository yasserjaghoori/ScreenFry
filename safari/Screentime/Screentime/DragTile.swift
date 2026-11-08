import AppKit

/// A tile the user drags straight onto Chrome's Extensions page (with Developer mode on),
/// which loads the folder as an unpacked extension. Clicking it reveals the folder in Finder.
final class DragTile: NSView, NSDraggingSource {
    var folder: URL
    private let icon = NSImageView()
    private let title = NSTextField(labelWithString: "ScreenFry for Chrome")
    private let hint = NSTextField(labelWithString: "Drag me onto the Extensions page")

    init(folder: URL) {
        self.folder = folder
        super.init(frame: .zero)
        wantsLayer = true
        layer?.cornerRadius = 14
        layer?.borderWidth = 1.5
        translatesAutoresizingMaskIntoConstraints = false
        toolTip = folder.path

        icon.image = NSApp.applicationIconImage
        icon.imageScaling = .scaleProportionallyUpOrDown
        title.font = .systemFont(ofSize: 14, weight: .semibold)
        hint.font = .systemFont(ofSize: 12)
        hint.textColor = .secondaryLabelColor

        let text = NSStackView(views: [title, hint])
        text.orientation = .vertical
        text.alignment = .leading
        text.spacing = 2
        let row = NSStackView(views: [icon, text])
        row.orientation = .horizontal
        row.alignment = .centerY
        row.spacing = 12
        row.translatesAutoresizingMaskIntoConstraints = false
        addSubview(row)
        NSLayoutConstraint.activate([
            icon.widthAnchor.constraint(equalToConstant: 44),
            icon.heightAnchor.constraint(equalToConstant: 44),
            row.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 14),
            row.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -14),
            row.centerYAnchor.constraint(equalTo: centerYAnchor),
            heightAnchor.constraint(equalToConstant: 72),
        ])
        updateColors()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        updateColors()
    }

    private func updateColors() {
        effectiveAppearance.performAsCurrentDrawingAppearance {
            layer?.backgroundColor = NSColor.controlBackgroundColor.cgColor
            layer?.borderColor = NSColor.systemOrange.withAlphaComponent(0.7).cgColor
        }
    }

    override func resetCursorRects() {
        addCursorRect(bounds, cursor: .openHand)
    }

    override func mouseDragged(with event: NSEvent) {
        let item = NSDraggingItem(pasteboardWriter: folder as NSURL)
        let image = NSWorkspace.shared.icon(forFile: folder.path)
        image.size = NSSize(width: 64, height: 64)
        let point = convert(event.locationInWindow, from: nil)
        item.setDraggingFrame(NSRect(x: point.x - 32, y: point.y - 32, width: 64, height: 64), contents: image)
        beginDraggingSession(with: [item], event: event, source: self)
    }

    override func mouseUp(with event: NSEvent) {
        if event.clickCount == 1 { NSWorkspace.shared.activateFileViewerSelecting([folder]) }
    }

    func draggingSession(_ session: NSDraggingSession, sourceOperationMaskFor context: NSDraggingContext) -> NSDragOperation {
        context == .outsideApplication ? [.copy, .link, .generic] : []
    }
}

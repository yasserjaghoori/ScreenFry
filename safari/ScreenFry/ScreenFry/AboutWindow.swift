import AppKit

/// ScreenFry's About sheet in the Mac app: version, what the app does and where data lives.
/// Each browser's extension has its own About page with that browser's details.
enum AboutWindow {
    static func show(on window: NSWindow, version: String, ember: NSColor) {
        let sheet = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 460, height: 10),
            styleMask: [.titled, .docModalWindow],
            backing: .buffered,
            defer: false
        )
        let logo = NSImageView()
        logo.image = NSApp.applicationIconImage
        logo.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([logo.widthAnchor.constraint(equalToConstant: 72), logo.heightAnchor.constraint(equalToConstant: 72)])
        let title = NSTextField(labelWithString: "ScreenFry")
        title.font = .systemFont(ofSize: 22, weight: .bold)
        let subtitle = NSTextField(labelWithString: "Version \(version) · Less feed. More day.")
        subtitle.font = .systemFont(ofSize: 12)
        subtitle.textColor = .secondaryLabelColor

        func heading(_ text: String) -> NSTextField {
            let label = NSTextField(labelWithString: text)
            label.font = .systemFont(ofSize: 13, weight: .semibold)
            label.alignment = .center
            return label
        }
        func paragraph(_ text: String) -> NSTextField {
            let label = NSTextField(wrappingLabelWithString: text)
            label.font = .systemFont(ofSize: 12)
            label.textColor = .secondaryLabelColor
            label.preferredMaxLayoutWidth = 400
            label.alignment = .center
            return label
        }
        let link = NSButton(title: "Source code and releases", target: nil, action: nil)
        link.isBordered = false
        link.attributedTitle = NSAttributedString(string: link.title, attributes: [
            .foregroundColor: ember, .font: NSFont.systemFont(ofSize: 12, weight: .semibold),
            .underlineStyle: NSUnderlineStyle.single.rawValue,
        ])
        let opener = LinkTarget(url: URL(string: "https://github.com/yasserjaghoori/ScreenFry")!)
        link.target = opener
        link.action = #selector(LinkTarget.open(_:))

        // "Samir and Yasser", each name linking to their site.
        let credits = NSTextField(labelWithAttributedString: {
            let text = NSMutableAttributedString(string: "Samir and Yasser", attributes: [
                .font: NSFont.systemFont(ofSize: 12), .foregroundColor: NSColor.secondaryLabelColor,
            ])
            text.addAttribute(.link, value: URL(string: "https://bhron.org")!, range: NSRange(location: 0, length: 5))
            text.addAttribute(.link, value: URL(string: "https://unjamlabs.com")!, range: NSRange(location: 10, length: 6))
            return text
        }())
        credits.allowsEditingTextAttributes = true // makes the links clickable
        credits.isSelectable = true
        credits.alignment = .center

        let done = NSButton(title: "Done", target: nil, action: nil)
        done.bezelStyle = .rounded
        done.controlSize = .large
        done.bezelColor = ember
        done.keyEquivalent = "\r"
        let closer = SheetCloser(sheet: sheet, retained: [opener])
        done.target = closer
        done.action = #selector(SheetCloser.close(_:))

        let stack = NSStackView(views: [
            logo, title, subtitle,
            heading("What it does"),
            paragraph("ScreenFry hides distracting feeds and buttons, sets daily website limits, and lets you choose when websites are open, with Fry Time for a little guilt-free scrolling. This app carries the Safari and Chrome extensions, keeps them up to date together, and moves your presets between browsers."),
            heading("On this Mac"),
            paragraph("Each browser keeps its own settings, usage and optional password; Safari and Chrome don’t share them. Time counts on the focused tab and while audio or video plays. There are no accounts, servers or analytics, and nothing leaves your Mac."),
            heading("Made by"),
            credits,
            link, done,
        ])
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 8
        stack.setCustomSpacing(2, after: title)
        stack.setCustomSpacing(16, after: subtitle)
        stack.setCustomSpacing(18, after: link)
        stack.edgeInsets = NSEdgeInsets(top: 24, left: 28, bottom: 22, right: 28)
        sheet.contentView = stack
        sheet.setContentSize(stack.fittingSize)
        window.beginSheet(sheet)
        objc_setAssociatedObject(sheet, &closerKey, closer, .OBJC_ASSOCIATION_RETAIN)
    }
    private static var closerKey = 0
}

private final class LinkTarget: NSObject {
    let url: URL
    init(url: URL) { self.url = url }
    @objc func open(_ sender: Any?) { NSWorkspace.shared.open(url) }
}

private final class SheetCloser: NSObject {
    weak var sheet: NSWindow?
    let retained: [AnyObject]
    init(sheet: NSWindow, retained: [AnyObject]) {
        self.sheet = sheet
        self.retained = retained
    }
    @objc func close(_ sender: Any?) {
        guard let sheet else { return }
        sheet.sheetParent?.endSheet(sheet)
    }
}

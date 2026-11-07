import AppKit
import SafariServices

/// Minimal containing app required to distribute a Safari Web Extension.
/// It only explains how to enable the extension; it is not the Phase 2 macOS app.
@main
enum ScreenFryApp {
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        withExtendedLifetime(delegate) { app.run() }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private static let ember = NSColor(srgbRed: 244 / 255, green: 98 / 255, blue: 31 / 255, alpha: 1)

    private var window: NSWindow!
    private let statusDot = NSView()
    private let status = NSTextField(labelWithString: "Checking Safari…")
    private var extensionIdentifier: String { (Bundle.main.bundleIdentifier ?? "com.screentime.Screentime") + ".Extension" }

    func applicationWillFinishLaunching(_ notification: Notification) {
        // Set the Dock icon from a bundled image as well as the asset catalog, so a stale
        // LaunchServices icon cache can never leave the Dock showing the generic placeholder.
        if let url = Bundle.main.url(forResource: "BrandIcon", withExtension: "png"),
           let image = NSImage(contentsOf: url) {
            NSApp.applicationIconImage = image
        }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 520, height: 500),
            styleMask: [.titled, .closable, .miniaturizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "ScreenFry"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.isMovableByWindowBackground = true
        window.center()

        let logo = NSImageView()
        logo.image = NSApp.applicationIconImage
        logo.imageScaling = .scaleProportionallyUpOrDown
        logo.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            logo.widthAnchor.constraint(equalToConstant: 112),
            logo.heightAnchor.constraint(equalToConstant: 112),
        ])

        let title = NSTextField(labelWithString: "ScreenFry")
        title.font = .systemFont(ofSize: 30, weight: .bold)
        let subtitle = NSTextField(labelWithString: "Less feed. More day.")
        subtitle.font = .systemFont(ofSize: 15)
        subtitle.textColor = .secondaryLabelColor

        statusDot.wantsLayer = true
        statusDot.layer?.cornerRadius = 4
        statusDot.layer?.backgroundColor = NSColor.tertiaryLabelColor.cgColor
        statusDot.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            statusDot.widthAnchor.constraint(equalToConstant: 8),
            statusDot.heightAnchor.constraint(equalToConstant: 8),
        ])
        status.font = .systemFont(ofSize: 13, weight: .medium)
        status.textColor = .secondaryLabelColor
        let statusRow = NSStackView(views: [statusDot, status])
        statusRow.orientation = .horizontal
        statusRow.alignment = .centerY
        statusRow.spacing = 8

        let steps = NSStackView(views: [
            stepRow(1, "In Safari Settings → Extensions, turn on ScreenFry."),
            stepRow(2, "Set ScreenFry to Allow on every website."),
            stepRow(3, "Turn on Allow in Private Browsing, then confirm it in the ScreenFry dashboard."),
        ])
        steps.orientation = .vertical
        steps.alignment = .leading
        steps.spacing = 12

        let button = NSButton(title: "Open Safari Extension Settings", target: self, action: #selector(openSafariSettings(_:)))
        button.bezelStyle = .rounded
        button.controlSize = .large
        button.keyEquivalent = "\r"
        button.bezelColor = Self.ember

        let stack = NSStackView(views: [logo, title, subtitle, statusRow, steps, button])
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 10
        stack.setCustomSpacing(16, after: logo)
        stack.setCustomSpacing(4, after: title)
        stack.setCustomSpacing(18, after: subtitle)
        stack.setCustomSpacing(26, after: statusRow)
        stack.setCustomSpacing(28, after: steps)
        stack.translatesAutoresizingMaskIntoConstraints = false

        let content = window.contentView!
        content.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: content.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: content.centerYAnchor, constant: 8),
            stack.widthAnchor.constraint(lessThanOrEqualToConstant: 420),
        ])
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        refreshState()
    }

    func applicationDidBecomeActive(_ notification: Notification) { refreshState() }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    private func stepRow(_ number: Int, _ text: String) -> NSView {
        let badge = NSTextField(labelWithString: "\(number)")
        badge.font = .systemFont(ofSize: 12, weight: .bold)
        badge.textColor = .white
        badge.alignment = .center
        badge.wantsLayer = true
        badge.drawsBackground = false
        let circle = NSView()
        circle.wantsLayer = true
        circle.layer?.cornerRadius = 11
        circle.layer?.backgroundColor = Self.ember.cgColor
        circle.translatesAutoresizingMaskIntoConstraints = false
        badge.translatesAutoresizingMaskIntoConstraints = false
        circle.addSubview(badge)
        NSLayoutConstraint.activate([
            circle.widthAnchor.constraint(equalToConstant: 22),
            circle.heightAnchor.constraint(equalToConstant: 22),
            badge.centerXAnchor.constraint(equalTo: circle.centerXAnchor),
            badge.centerYAnchor.constraint(equalTo: circle.centerYAnchor),
        ])
        let label = NSTextField(wrappingLabelWithString: text)
        label.font = .systemFont(ofSize: 13)
        label.preferredMaxLayoutWidth = 370
        let row = NSStackView(views: [circle, label])
        row.orientation = .horizontal
        row.alignment = .top
        row.spacing = 12
        return row
    }

    /// Safari reports whether the extension is enabled. It does not report Private Browsing access.
    private func refreshState() {
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionIdentifier) { [weak self] state, error in
            DispatchQueue.main.async {
                guard let self else { return }
                if let state {
                    self.status.stringValue = state.isEnabled ? "ScreenFry is on in Safari" : "Installed, but turned off in Safari"
                    self.statusDot.layer?.backgroundColor = (state.isEnabled ? NSColor.systemGreen : Self.ember).cgColor
                } else {
                    self.status.stringValue = "Couldn’t read the extension state\(error.map { ": \($0.localizedDescription)" } ?? ".")"
                    self.statusDot.layer?.backgroundColor = NSColor.tertiaryLabelColor.cgColor
                }
            }
        }
    }

    @objc private func openSafariSettings(_ sender: Any?) {
        SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionIdentifier) { error in
            if let error { NSLog("ScreenFry: unable to open Safari settings: \(error.localizedDescription)") }
        }
    }

    private func buildMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Quit ScreenFry", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        NSApp.mainMenu = main
    }
}

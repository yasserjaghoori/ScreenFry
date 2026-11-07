import AppKit
import SafariServices

/// Minimal containing app required to distribute a Safari Web Extension.
/// It only explains how to enable the extension; it is not the Phase 2 macOS app.
@main
enum ScreentimeApp {
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        withExtendedLifetime(delegate) { app.run() }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow!
    private let status = NSTextField(labelWithString: "Checking Safari…")
    private var extensionIdentifier: String { (Bundle.main.bundleIdentifier ?? "com.screentime.Screentime") + ".Extension" }

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()
        let frame = NSRect(x: 0, y: 0, width: 560, height: 360)
        window = NSWindow(contentRect: frame, styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "Screentime"
        window.center()

        let title = NSTextField(labelWithString: "Screentime for Safari")
        title.font = .boldSystemFont(ofSize: 24)
        let detail = NSTextField(wrappingLabelWithString: "1. Open Safari Settings → Extensions and turn on Screentime.\n2. Allow it on all websites.\n3. Turn on “Allow in Private Browsing”, then confirm coverage from Screentime’s dashboard.")
        detail.textColor = .secondaryLabelColor
        detail.preferredMaxLayoutWidth = 460
        status.textColor = .secondaryLabelColor
        let button = NSButton(title: "Open Safari Extension Settings", target: self, action: #selector(openSafariSettings(_:)))
        button.bezelStyle = .rounded
        button.keyEquivalent = "\r"
        let stack = NSStackView(views: [title, detail, status, button])
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false
        window.contentView?.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: window.contentView!.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: window.contentView!.centerYAnchor),
            stack.widthAnchor.constraint(lessThanOrEqualToConstant: 480)
        ])
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        refreshState()
    }

    func applicationDidBecomeActive(_ notification: Notification) { refreshState() }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    /// Safari reports whether the extension is enabled. It does not report Private Browsing access.
    private func refreshState() {
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionIdentifier) { [weak self] state, error in
            DispatchQueue.main.async {
                if let state {
                    self?.status.stringValue = state.isEnabled ? "Screentime is enabled in Safari." : "Screentime is installed but turned off in Safari."
                } else {
                    self?.status.stringValue = "Couldn’t read the extension state\(error.map { ": \($0.localizedDescription)" } ?? ".")"
                }
            }
        }
    }

    @objc private func openSafariSettings(_ sender: Any?) {
        SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionIdentifier) { error in
            if let error { NSLog("Screentime: unable to open Safari settings: \(error.localizedDescription)") }
        }
    }

    private func buildMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Quit Screentime", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        NSApp.mainMenu = main
    }
}

import AppKit
import SafariServices

@main
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow!

    func applicationDidFinishLaunching(_ notification: Notification) {
        let frame = NSRect(x: 0, y: 0, width: 520, height: 320)
        window = NSWindow(contentRect: frame, styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "Screentime"
        window.center()

        let title = NSTextField(labelWithString: "Screentime is installed.")
        title.font = .boldSystemFont(ofSize: 24)
        let detail = NSTextField(labelWithString: "Enable the extension and website access in Safari Settings.")
        detail.textColor = .secondaryLabelColor
        let button = NSButton(title: "Open Safari Settings", target: self, action: #selector(openSafariPreferences(_:)))
        button.bezelStyle = .rounded
        let stack = NSStackView(views: [title, detail, button])
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 18
        stack.translatesAutoresizingMaskIntoConstraints = false
        window.contentView?.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: window.contentView!.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: window.contentView!.centerYAnchor)
        ])
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc private func openSafariPreferences(_ sender: Any?) {
        SFSafariApplication.showPreferencesForExtension(
            withIdentifier: "com.screentime.Screentime.Extension"
        ) { error in
            if let error { NSLog("Unable to open Safari extension preferences: \(error.localizedDescription)") }
        }
    }
}

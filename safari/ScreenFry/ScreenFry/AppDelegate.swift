import AppKit
import SafariServices
import Security
#if canImport(Sparkle)
import Sparkle
#endif

/// ScreenFry's Mac app. It ships the Safari extension inside itself, keeps the Chrome
/// extension folder current, walks the user through turning both on, and updates everything
/// together (see docs/DISTRIBUTION.md).
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
    private static let chromeBundleID = "com.google.Chrome"

    private var window: NSWindow!
    private let safariDot = NSView()
    private let safariStatus = NSTextField(labelWithString: "Checking Safari…")
    private let chromeDot = NSView()
    private let chromeStatus = NSTextField(labelWithString: "")
    private let notice = NSTextField(wrappingLabelWithString: "")
    private var extensionIdentifier: String { (Bundle.main.bundleIdentifier ?? "com.screentime.Screentime") + ".Extension" }
    private var version: String { Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "" }

    #if canImport(Sparkle)
    /// In-app updates from GitHub Releases. They stay off until a signing key is configured
    /// (SUPublicEDKey), so an unconfigured build can never install an unverified download.
    private lazy var updater = SPUStandardUpdaterController(
        startingUpdater: Self.updatesConfigured, updaterDelegate: nil, userDriverDelegate: nil)
    #endif
    private static var updatesConfigured: Bool {
        let key = Bundle.main.infoDictionary?["SUPublicEDKey"] as? String ?? ""
        return !key.isEmpty
    }

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
        if runningFromDiskImage() { return }
        #if canImport(Sparkle)
        _ = updater
        #endif
        buildWindow()
        installChromeExtension()
        warnAboutOtherCopies()
        refreshState()
    }

    func applicationDidBecomeActive(_ notification: Notification) { refreshState() }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    // MARK: Install checks

    /// Opened straight from the download (or quarantined in place)? Safari would register the
    /// extension from a temporary location, so ask the user to drag the app to Applications.
    private func runningFromDiskImage() -> Bool {
        let path = Bundle.main.bundlePath
        guard path.hasPrefix("/Volumes/") || path.contains("/AppTranslocation/") else { return false }
        let alert = NSAlert()
        alert.messageText = "Move ScreenFry to Applications first"
        alert.informativeText = "Drag ScreenFry into the Applications folder in the download window, then open it from Applications."
        alert.addButton(withTitle: "Quit")
        NSApp.activate(ignoringOtherApps: true)
        alert.runModal()
        NSApp.terminate(nil)
        return true
    }

    /// Two installed copies register two Safari extensions with the same identity, which makes
    /// Safari flaky. Point the user to any other copy.
    private func warnAboutOtherCopies() {
        guard let id = Bundle.main.bundleIdentifier else { return }
        let others = NSWorkspace.shared.urlsForApplications(withBundleIdentifier: id).filter {
            $0.standardizedFileURL != Bundle.main.bundleURL.standardizedFileURL
                && !$0.path.contains("/DerivedData/") && !$0.path.contains("/.Trash/")
        }
        guard let other = others.first else { return }
        notice.stringValue = "Another copy of ScreenFry is installed at \(other.deletingLastPathComponent().path). Keep only this one: move the other copy to the Trash."
        notice.isHidden = false
    }

    private func installChromeExtension() {
        do {
            try ChromeInstaller.sync()
        } catch {
            chromeStatus.stringValue = "Couldn’t prepare the Chrome extension: \(error.localizedDescription)"
        }
    }

    // MARK: Window

    private func buildWindow() {
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 560, height: 700),
            styleMask: [.titled, .closable, .miniaturizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "ScreenFry"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.isMovableByWindowBackground = true

        let logo = NSImageView()
        logo.image = NSApp.applicationIconImage
        logo.imageScaling = .scaleProportionallyUpOrDown
        logo.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            logo.widthAnchor.constraint(equalToConstant: 64),
            logo.heightAnchor.constraint(equalToConstant: 64),
        ])
        let title = NSTextField(labelWithString: "ScreenFry")
        title.font = .systemFont(ofSize: 26, weight: .bold)
        let subtitle = NSTextField(labelWithString: "Version \(version) · Less feed. More day.")
        subtitle.font = .systemFont(ofSize: 13)
        subtitle.textColor = .secondaryLabelColor
        let titles = NSStackView(views: [title, subtitle])
        titles.orientation = .vertical
        titles.alignment = .leading
        titles.spacing = 2
        let updateButton = NSButton(title: "Check for Updates…", target: self, action: #selector(checkForUpdates(_:)))
        updateButton.bezelStyle = .rounded
        updateButton.isEnabled = Self.updatesConfigured
        if !Self.updatesConfigured {
            updateButton.toolTip = "Automatic updates turn on once this build is published with an update signing key."
        }
        let spacer = NSView()
        spacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
        let header = NSStackView(views: [logo, titles, spacer, updateButton])
        header.orientation = .horizontal
        header.alignment = .centerY
        header.spacing = 14

        notice.font = .systemFont(ofSize: 12, weight: .medium)
        notice.textColor = .systemOrange
        notice.isHidden = true
        notice.preferredMaxLayoutWidth = 500

        let safari = card(
            title: "Safari", dot: safariDot, status: safariStatus,
            steps: [
                "Click Open Safari Settings, then turn on ScreenFry.",
                "Click Edit Websites and set Other Websites to Allow.",
                "Optional: turn on Allow in Private Browsing.",
            ] + (Self.isDeveloperIDSigned ? [] : [
                "Don’t see ScreenFry in the list? This test build isn’t signed by Apple yet. In Safari → Settings → Advanced, turn on “Show features for web developers”, then choose Develop → Allow Unsigned Extensions and look again.",
            ]),
            actions: [button("Open Safari Settings", #selector(openSafariSettings(_:)), primary: true)])

        let chromeInstalled = NSWorkspace.shared.urlForApplication(withBundleIdentifier: Self.chromeBundleID) != nil
        let chromeSteps = chromeInstalled ? [
            "Click Open Chrome Extensions.",
            "Turn on Developer mode (top-right switch on that page).",
            "Drag the ScreenFry tile below onto that page. Pin ScreenFry from the puzzle-piece menu.",
        ] : ["Google Chrome isn’t installed. Install it, then reopen ScreenFry to set it up."]
        var chromeActions: [NSView] = []
        if chromeInstalled {
            chromeActions.append(button("Open Chrome Extensions", #selector(openChromeExtensions(_:)), primary: true))
            chromeActions.append(button("Show Folder", #selector(revealChromeFolder(_:)), primary: false))
        }
        let chrome = card(title: "Chrome", dot: chromeDot, status: chromeStatus, steps: chromeSteps, actions: chromeActions)
        if chromeInstalled, let stack = chrome.subviews.first as? NSStackView {
            let tile = DragTile(folder: ChromeInstaller.folder)
            stack.addArrangedSubview(tile)
            tile.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
            let foot = NSTextField(wrappingLabelWithString: "Set up once. When ScreenFry updates, the Chrome extension updates and reloads itself.")
            foot.font = .systemFont(ofSize: 11)
            foot.textColor = .secondaryLabelColor
            stack.addArrangedSubview(foot)
        }

        let stack = NSStackView(views: [header, notice, safari, chrome])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false
        let content = window.contentView!
        content.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: content.topAnchor, constant: 40),
            stack.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 28),
            stack.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -28),
            stack.bottomAnchor.constraint(lessThanOrEqualTo: content.bottomAnchor, constant: -24),
            header.widthAnchor.constraint(equalTo: stack.widthAnchor),
            safari.widthAnchor.constraint(equalTo: stack.widthAnchor),
            chrome.widthAnchor.constraint(equalTo: stack.widthAnchor),
        ])
        window.setContentSize(content.fittingSize)
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    /// A rounded section with a title, status dot, numbered steps and buttons.
    private func card(title: String, dot: NSView, status: NSTextField, steps: [String], actions: [NSView]) -> NSView {
        let box = NSView()
        box.wantsLayer = true
        box.layer?.cornerRadius = 14
        box.layer?.backgroundColor = NSColor.quaternaryLabelColor.withAlphaComponent(0.08).cgColor
        box.translatesAutoresizingMaskIntoConstraints = false

        let heading = NSTextField(labelWithString: title)
        heading.font = .systemFont(ofSize: 17, weight: .semibold)
        dot.wantsLayer = true
        dot.layer?.cornerRadius = 4
        dot.layer?.backgroundColor = NSColor.tertiaryLabelColor.cgColor
        dot.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([dot.widthAnchor.constraint(equalToConstant: 8), dot.heightAnchor.constraint(equalToConstant: 8)])
        status.font = .systemFont(ofSize: 12, weight: .medium)
        status.textColor = .secondaryLabelColor
        let statusRow = NSStackView(views: [dot, status])
        statusRow.spacing = 6
        statusRow.alignment = .centerY
        let top = NSStackView(views: [heading, statusRow])
        top.orientation = .horizontal
        top.alignment = .firstBaseline
        top.spacing = 12

        let stack = NSStackView(views: [top] + steps.enumerated().map { stepRow($0.offset + 1, $0.element) })
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 10
        if !actions.isEmpty {
            let row = NSStackView(views: actions)
            row.spacing = 8
            stack.addArrangedSubview(row)
        }
        stack.translatesAutoresizingMaskIntoConstraints = false
        box.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: box.topAnchor, constant: 16),
            stack.leadingAnchor.constraint(equalTo: box.leadingAnchor, constant: 18),
            stack.trailingAnchor.constraint(equalTo: box.trailingAnchor, constant: -18),
            stack.bottomAnchor.constraint(equalTo: box.bottomAnchor, constant: -16),
        ])
        return box
    }

    private func button(_ title: String, _ action: Selector, primary: Bool) -> NSButton {
        let b = NSButton(title: title, target: self, action: action)
        b.bezelStyle = .rounded
        b.controlSize = .large
        if primary { b.bezelColor = Self.ember }
        return b
    }

    private func stepRow(_ number: Int, _ text: String) -> NSView {
        let badge = NSTextField(labelWithString: "\(number)")
        badge.font = .systemFont(ofSize: 11, weight: .bold)
        badge.textColor = .white
        badge.alignment = .center
        let circle = NSView()
        circle.wantsLayer = true
        circle.layer?.cornerRadius = 10
        circle.layer?.backgroundColor = Self.ember.cgColor
        circle.translatesAutoresizingMaskIntoConstraints = false
        badge.translatesAutoresizingMaskIntoConstraints = false
        circle.addSubview(badge)
        NSLayoutConstraint.activate([
            circle.widthAnchor.constraint(equalToConstant: 20),
            circle.heightAnchor.constraint(equalToConstant: 20),
            badge.centerXAnchor.constraint(equalTo: circle.centerXAnchor),
            badge.centerYAnchor.constraint(equalTo: circle.centerYAnchor),
        ])
        let label = NSTextField(wrappingLabelWithString: text)
        label.font = .systemFont(ofSize: 13)
        label.preferredMaxLayoutWidth = 440
        let row = NSStackView(views: [circle, label])
        row.orientation = .horizontal
        row.alignment = .top
        row.spacing = 10
        return row
    }

    // MARK: State

    /// Safari reports whether the extension is enabled. Chrome offers no way for an app to
    /// check, so the Chrome status reports the prepared folder instead.
    private func refreshState() {
        if let installed = ChromeInstaller.installedVersion {
            chromeStatus.stringValue = "Extension folder ready (v\(installed))"
            chromeDot.layer?.backgroundColor = NSColor.systemGreen.cgColor
        }
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionIdentifier) { [weak self] state, error in
            DispatchQueue.main.async {
                guard let self else { return }
                if let state {
                    self.safariStatus.stringValue = state.isEnabled ? "On in Safari" : "Installed, turned off"
                    self.safariDot.layer?.backgroundColor = (state.isEnabled ? NSColor.systemGreen : Self.ember).cgColor
                } else {
                    self.safariStatus.stringValue = "Not visible to Safari yet\(error.map { " (\($0.localizedDescription))" } ?? "")"
                    self.safariDot.layer?.backgroundColor = NSColor.tertiaryLabelColor.cgColor
                }
            }
        }
    }

    /// Developer ID–signed builds work in Safari without developer settings.
    private static var isDeveloperIDSigned: Bool {
        var code: SecStaticCode?
        guard SecStaticCodeCreateWithPath(Bundle.main.bundleURL as CFURL, [], &code) == errSecSuccess, let code else { return false }
        var info: CFDictionary?
        guard SecCodeCopySigningInformation(code, SecCSFlags(rawValue: kSecCSSigningInformation), &info) == errSecSuccess,
              let dict = info as? [String: Any],
              let certificates = dict[kSecCodeInfoCertificates as String] as? [SecCertificate],
              let leaf = certificates.first,
              let name = SecCertificateCopySubjectSummary(leaf) as String?
        else { return false }
        return name.hasPrefix("Developer ID Application")
    }

    // MARK: Actions

    @objc private func openSafariSettings(_ sender: Any?) {
        SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionIdentifier) { error in
            if let error { NSLog("ScreenFry: unable to open Safari settings: \(error.localizedDescription)") }
        }
    }

    @objc private func openChromeExtensions(_ sender: Any?) {
        guard let chrome = NSWorkspace.shared.urlForApplication(withBundleIdentifier: Self.chromeBundleID),
              let page = URL(string: "chrome://extensions") else { return }
        // Also copy the address, in case Chrome declines to open an internal page from outside.
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString("chrome://extensions", forType: .string)
        NSWorkspace.shared.open([page], withApplicationAt: chrome, configuration: NSWorkspace.OpenConfiguration()) { _, error in
            if let error { NSLog("ScreenFry: unable to open Chrome: \(error.localizedDescription)") }
        }
    }

    @objc private func revealChromeFolder(_ sender: Any?) {
        NSWorkspace.shared.activateFileViewerSelecting([ChromeInstaller.folder])
    }

    @objc private func checkForUpdates(_ sender: Any?) {
        #if canImport(Sparkle)
        updater.checkForUpdates(sender)
        #endif
    }

    private func buildMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.autoenablesItems = false
        appMenu.addItem(withTitle: "About ScreenFry", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        let update = NSMenuItem(title: "Check for Updates…", action: #selector(checkForUpdates(_:)), keyEquivalent: "")
        update.target = self
        update.isEnabled = Self.updatesConfigured
        appMenu.addItem(update)
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit ScreenFry", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        let editItem = NSMenuItem()
        main.addItem(editItem)
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editItem.submenu = edit
        NSApp.mainMenu = main
    }
}

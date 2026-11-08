import AppKit
import SafariServices
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
    private var chromeDropAccepted = false
    private var chromePreparationError: String?
    private lazy var chromeConfirmation = NSButton(checkboxWithTitle: "ScreenFry appears in Chrome’s Extensions page", target: self, action: #selector(confirmChromeSetup(_:)))
    private static let chromeConfirmedKey = "chromeSetupConfirmedByUser"
    /// Set to false in project.yml when the public Safari distribution is ready.
    private static var showsSafariDeveloperSetup: Bool {
        Bundle.main.object(forInfoDictionaryKey: "ScreenFryShowSafariDeveloperSetup") as? Bool ?? true
    }
    private let notice = NSTextField(wrappingLabelWithString: "")
    private lazy var ejectButton = button("Eject Installer", #selector(ejectInstaller(_:)), primary: false)
    private var installerVolume: URL?
    private var extensionIdentifier: String { (Bundle.main.bundleIdentifier ?? "com.screenfry.ScreenFry") + ".Extension" }
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
    /// Safari flaky. The installer disk image left mounted counts too (Safari can register the
    /// extension inside it), but it is not a real install: offer to eject it instead.
    private func warnAboutOtherCopies() {
        guard let id = Bundle.main.bundleIdentifier else { return }
        let others = NSWorkspace.shared.urlsForApplications(withBundleIdentifier: id).filter {
            $0.standardizedFileURL != Bundle.main.bundleURL.standardizedFileURL
                && FileManager.default.fileExists(atPath: $0.path)
                && !$0.path.contains("/DerivedData/") && !$0.path.contains("/Build/Products/")
                && !$0.path.contains("/.Trash/")
        }
        if let installer = others.first(where: { $0.path.hasPrefix("/Volumes/") }) {
            installerVolume = URL(fileURLWithPath: "/Volumes").appendingPathComponent(installer.pathComponents[2])
            ejectButton.isHidden = false
            notice.stringValue = "The ScreenFry installer is still open. Eject it now that ScreenFry is in Applications."
            notice.isHidden = false
        } else if let other = others.first {
            notice.stringValue = "Another copy of ScreenFry is installed at \(other.deletingLastPathComponent().path). Keep only one: move the other copy to the Trash."
            notice.isHidden = false
        }
    }

    @objc private func ejectInstaller(_ sender: Any?) {
        guard let volume = installerVolume else { return }
        do {
            try NSWorkspace.shared.unmountAndEjectDevice(at: volume)
            notice.isHidden = true
            ejectButton.isHidden = true
        } catch {
            notice.stringValue = "Couldn’t eject the installer (\(error.localizedDescription)). Eject “ScreenFry” in Finder’s sidebar."
        }
    }

    private func installChromeExtension() {
        do {
            try ChromeInstaller.sync()
        } catch {
            chromePreparationError = error.localizedDescription
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
        if !Self.updatesConfigured {
            updateButton.toolTip = "Open ScreenFry releases to check for a newer download."
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
        notice.preferredMaxLayoutWidth = 360

        var safariRows: [NSView] = [
            stepRow(1, "Open Safari’s settings."),
            button("Open Safari Settings", #selector(openSafariSettings(_:)), primary: true),
        ]
        if Self.showsSafariDeveloperSetup {
            safariRows.append(stepRow(2, "In Advanced, turn on “Show features for web developers”. Open the Developer tab, then turn on “Allow unsigned extensions”. Repeat after restarting Safari.", bold: "Show features for web developers"))
        }
        let enableStep = Self.showsSafariDeveloperSetup ? 3 : 2
        safariRows += [
            stepRow(enableStep, "Go to Extensions and check the box beside ScreenFry."),
            stepRow(enableStep + 1, "When the website-access popup appears, check “Remember for other websites”, then press “Always Allow”.", bold: "Remember for other websites"),
            helperLabel("Already enabled? In Edit Websites, set Other Websites to Allow. Optional: turn on Allow in Private Browsing."),
        ]
        let safari = card(title: "Safari", dot: safariDot, status: safariStatus, rows: safariRows)

        let chromeInstalled = NSWorkspace.shared.urlForApplication(withBundleIdentifier: Self.chromeBundleID) != nil
        var chromeRows: [NSView] = []
        if chromeInstalled {
            let tile = DragTile(folder: ChromeInstaller.folder)
            tile.onDropAccepted = { [weak self] in
                self?.chromeDropAccepted = true
                self?.refreshState()
            }
            chromeConfirmation.state = UserDefaults.standard.bool(forKey: Self.chromeConfirmedKey) ? .on : .off
            chromeRows = [
                stepRow(1, "Open the Extensions page.", action: button("Open Chrome Extensions", #selector(openChromeExtensions(_:)), primary: true)),
                stepRow(2, "Turn on Developer mode (top-right switch on that page).", bold: "top-right switch"),
                developerModeScreenshots(),
                stepRow(3, "Drag this tile onto the Extensions page. Or click it to show the folder, then select that folder with Load unpacked."),
                tile,
                chromeConfirmation,
                helperLabel("Pin ScreenFry from Chrome’s puzzle-piece menu. Setup confirmation is saved here; Chrome doesn’t report whether you later turn it off or remove it."),
            ]
        } else {
            chromeRows = [helperLabel("Google Chrome isn’t installed. Install it, then reopen ScreenFry to set it up.")]
        }
        let chrome = card(title: "Chrome", dot: chromeDot, status: chromeStatus, rows: chromeRows)

        let request = NSButton(title: "Browser not listed here? Press here to request a new one.", target: self, action: #selector(requestBrowser(_:)))
        request.isBordered = false
        request.alignment = .left
        let requestText = NSMutableAttributedString(string: request.title, attributes: [.font: NSFont.systemFont(ofSize: 12), .foregroundColor: NSColor.secondaryLabelColor])
        requestText.addAttributes([.underlineStyle: NSUnderlineStyle.single.rawValue, .foregroundColor: NSColor.linkColor], range: (request.title as NSString).range(of: "Press here"))
        request.attributedTitle = requestText
        request.toolTip = "Open a browser request on GitHub (you review and submit it)."
        let browsers = NSStackView(views: [safari, chrome, request])
        browsers.orientation = .vertical
        browsers.alignment = .leading
        browsers.spacing = 14
        browsers.edgeInsets = NSEdgeInsets(top: 14, left: 14, bottom: 14, right: 14)
        browsers.wantsLayer = true
        browsers.layer?.cornerRadius = 16
        browsers.layer?.backgroundColor = NSColor.quaternaryLabelColor.withAlphaComponent(0.08).cgColor
        safari.widthAnchor.constraint(equalTo: browsers.widthAnchor, constant: -28).isActive = true
        chrome.widthAnchor.constraint(equalTo: safari.widthAnchor).isActive = true

        ejectButton.isHidden = true
        let noticeRow = NSStackView(views: [notice, ejectButton])
        noticeRow.orientation = .horizontal
        noticeRow.alignment = .centerY
        noticeRow.spacing = 10
        let uninstallButton = NSButton(title: "Uninstall…", target: self, action: #selector(uninstall(_:)))
        uninstallButton.bezelStyle = .inline
        let stack = NSStackView(views: [header, noticeRow, browsers, uninstallButton])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false
        let content = window.contentView!
        let scroll = NSScrollView()
        scroll.hasVerticalScroller = true
        scroll.drawsBackground = false
        scroll.translatesAutoresizingMaskIntoConstraints = false
        let document = FlippedSetupView()
        document.translatesAutoresizingMaskIntoConstraints = false
        scroll.documentView = document
        content.addSubview(scroll)
        document.addSubview(stack)
        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: content.topAnchor, constant: 32),
            scroll.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            scroll.bottomAnchor.constraint(equalTo: content.bottomAnchor),
            document.widthAnchor.constraint(equalTo: scroll.contentView.widthAnchor),
            stack.topAnchor.constraint(equalTo: document.topAnchor, constant: 12),
            stack.leadingAnchor.constraint(equalTo: document.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: document.trailingAnchor, constant: -24),
            stack.bottomAnchor.constraint(equalTo: document.bottomAnchor, constant: -24),
            header.widthAnchor.constraint(equalTo: stack.widthAnchor),
            browsers.widthAnchor.constraint(equalTo: stack.widthAnchor),
        ])
        let availableHeight = (NSScreen.main?.visibleFrame.height ?? 900) - 60
        window.setContentSize(NSSize(width: 660, height: min(900, availableHeight)))
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    /// A rounded section with a title, status dot, numbered steps and buttons.
    private func card(title: String, dot: NSView, status: NSTextField, rows: [NSView]) -> NSView {
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

        let stack = NSStackView(views: [top] + rows)
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 10
        rows.forEach { row in
            if row is NSStackView || row is DragTile || row is NSTextField {
                row.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
            }
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

    private func helperLabel(_ text: String) -> NSTextField {
        let label = NSTextField(wrappingLabelWithString: text)
        label.font = .systemFont(ofSize: 11)
        label.textColor = .secondaryLabelColor
        label.preferredMaxLayoutWidth = 540
        return label
    }

    private func developerModeScreenshots() -> NSView {
        func screenshot(_ name: String, caption: String) -> NSView {
            let image = NSImageView()
            image.image = NSImage(named: name)
            image.imageScaling = .scaleProportionallyUpOrDown
            image.setAccessibilityLabel("Chrome Extensions: Developer mode \(caption.lowercased())")
            image.widthAnchor.constraint(equalToConstant: 220).isActive = true
            image.heightAnchor.constraint(equalToConstant: 56).isActive = true
            let stack = NSStackView(views: [image, helperLabel(caption)])
            stack.orientation = .vertical
            stack.spacing = 3
            return stack
        }
        let arrow = NSTextField(labelWithString: "→")
        arrow.font = .systemFont(ofSize: 24, weight: .medium)
        arrow.textColor = Self.ember
        let row = NSStackView(views: [screenshot("ChromeDeveloperModeOff", caption: "Before: off"), arrow, screenshot("ChromeDeveloperModeOn", caption: "After: on")])
        row.orientation = .horizontal
        row.alignment = .centerY
        row.spacing = 12
        return row
    }

    private func stepRow(_ number: Int, _ text: String, bold: String? = nil, action: NSView? = nil) -> NSView {
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
        label.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        if let bold {
            let styled = NSMutableAttributedString(string: text, attributes: [.font: NSFont.systemFont(ofSize: 13), .foregroundColor: NSColor.labelColor])
            styled.addAttribute(.font, value: NSFont.systemFont(ofSize: 13, weight: .bold), range: (text as NSString).range(of: bold))
            label.attributedStringValue = styled
        }
        let row = NSStackView(views: [circle, label])
        if let action { row.addArrangedSubview(action) }
        row.orientation = .horizontal
        row.alignment = .top
        row.spacing = 10
        return row
    }

    // MARK: State

    /// A successful file drop is not proof of installation. Keep user confirmation explicit.
    private func refreshState() {
        if let error = chromePreparationError {
            chromeStatus.stringValue = "Couldn’t prepare Chrome: \(error)"
            chromeDot.layer?.backgroundColor = NSColor.systemOrange.cgColor
        } else if UserDefaults.standard.bool(forKey: Self.chromeConfirmedKey) {
            chromeStatus.stringValue = "Setup confirmed by you"
            chromeDot.layer?.backgroundColor = NSColor.systemGreen.cgColor
        } else if chromeDropAccepted {
            chromeStatus.stringValue = "Folder dropped — confirm below"
            chromeDot.layer?.backgroundColor = NSColor.systemOrange.cgColor
        } else if ChromeInstaller.installedVersion != nil {
            chromeStatus.stringValue = "Ready to add to Chrome"
            chromeDot.layer?.backgroundColor = Self.ember.cgColor
        }
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionIdentifier) { [weak self] state, error in
            DispatchQueue.main.async {
                guard let self else { return }
                if let state {
                    self.safariStatus.stringValue = state.isEnabled
                        ? "On in Safari"
                        : "Turned off — follow the steps below"
                    self.safariDot.layer?.backgroundColor = (state.isEnabled ? NSColor.systemGreen : Self.ember).cgColor
                } else {
                    self.safariStatus.stringValue = "Finish setup in Safari"
                    self.safariDot.layer?.backgroundColor = NSColor.tertiaryLabelColor.cgColor
                    if let error { NSLog("ScreenFry: Safari status unavailable: \(error.localizedDescription)") }
                }
            }
        }
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

    @objc private func confirmChromeSetup(_ sender: NSButton) {
        UserDefaults.standard.set(sender.state == .on, forKey: Self.chromeConfirmedKey)
        refreshState()
    }

    @objc private func requestBrowser(_ sender: Any?) {
        var url = URLComponents(string: "https://github.com/yasserjaghoori/ScreenFry/issues/new")!
        url.queryItems = [URLQueryItem(name: "title", value: "Browser request: "), URLQueryItem(name: "body", value: "Which browser would you like ScreenFry to support?\n\nBrowser:\nOperating system:\n")]
        if let url = url.url { NSWorkspace.shared.open(url) }
    }

    @objc private func checkForUpdates(_ sender: Any?) {
        guard Self.updatesConfigured else {
            NSWorkspace.shared.open(URL(string: "https://github.com/yasserjaghoori/ScreenFry/releases")!)
            return
        }
        #if canImport(Sparkle)
        updater.checkForUpdates(sender)
        #endif
    }

    // MARK: Uninstall

    @objc private func uninstall(_ sender: Any?) {
        let alert = NSAlert()
        alert.messageText = "Uninstall ScreenFry?"
        alert.informativeText = """
        Keep Settings removes the app, its Safari extension and the Chrome extension folder. \
        Chrome keeps ScreenFry’s settings until you click Remove on its Extensions page, so \
        reinstalling picks them up again.

        Erase Everything also deletes ScreenFry’s files and preferences on this Mac, then opens \
        Chrome’s Extensions page so you can click Remove, which deletes Chrome’s copy of the \
        settings. Safari removes its extension with the app.
        """
        alert.addButton(withTitle: "Keep Settings")
        alert.addButton(withTitle: "Erase Everything")
        alert.addButton(withTitle: "Cancel")
        alert.buttons[1].hasDestructiveAction = true
        let choice = alert.runModal()
        guard choice != .alertThirdButtonReturn else { return }
        performUninstall(erase: choice == .alertSecondButtonReturn)
    }

    private func performUninstall(erase: Bool) {
        let fm = FileManager.default
        let home = fm.homeDirectoryForCurrentUser
        let id = Bundle.main.bundleIdentifier ?? "com.screenfry.ScreenFry"
        // Unregister the Safari extension first so Safari drops it right away.
        if let appex = Bundle.main.builtInPlugInsURL?.appendingPathComponent("ScreenFry Extension.appex") {
            let task = Process()
            task.executableURL = URL(fileURLWithPath: "/usr/bin/pluginkit")
            task.arguments = ["-r", appex.path]
            try? task.run()
            task.waitUntilExit()
        }
        var paths = [ChromeInstaller.folder.deletingLastPathComponent()] // Application Support/ScreenFry
        if erase {
            paths += [
                home.appendingPathComponent("Library/Caches/\(id)"),
                home.appendingPathComponent("Library/HTTPStorages/\(id)"),
                home.appendingPathComponent("Library/Saved Application State/\(id).savedState"),
            ]
            UserDefaults.standard.removePersistentDomain(forName: id)
        }
        for path in paths where fm.fileExists(atPath: path.path) {
            try? fm.removeItem(at: path)
        }
        if erase, NSWorkspace.shared.urlForApplication(withBundleIdentifier: Self.chromeBundleID) != nil {
            openChromeExtensions(nil)
        }
        NSWorkspace.shared.recycle([Bundle.main.bundleURL]) { _, error in
            DispatchQueue.main.async {
                let done = NSAlert()
                if let error {
                    done.messageText = "Almost done"
                    done.informativeText = "ScreenFry’s data was removed, but the app couldn’t move itself to the Trash (\(error.localizedDescription)). Drag ScreenFry from Applications to the Trash."
                } else {
                    done.messageText = "ScreenFry is uninstalled"
                    done.informativeText = erase
                        ? "In Chrome’s Extensions page, click Remove on ScreenFry to delete its settings there."
                        : "Reinstall any time; Chrome keeps your ScreenFry settings until you remove it there."
                }
                done.runModal()
                NSApp.terminate(nil)
            }
        }
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
        appMenu.addItem(update)
        appMenu.addItem(.separator())
        let uninstallItem = NSMenuItem(title: "Uninstall ScreenFry…", action: #selector(uninstall(_:)), keyEquivalent: "")
        uninstallItem.target = self
        appMenu.addItem(uninstallItem)
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

private final class FlippedSetupView: NSView {
    override var isFlipped: Bool { true }
}

import AppKit
import ServiceManagement
import SafariServices
import UniformTypeIdentifiers
#if canImport(Sparkle)
import Sparkle
#endif

/// ScreenFry's Mac app. It ships the Safari extension inside itself, keeps the Chrome
/// extension folder current, walks the user through turning both on, and updates everything
/// together (see docs/DISTRIBUTION.md).
@main
enum ScreenFryApp {
    static func main() {
        // Chrome launches this binary as ScreenFry's native messaging host (settings export
        // and import); answer its one message and exit without starting the app.
        if ChromeNativeHost.isLaunchedByChrome(CommandLine.arguments) {
            ChromeNativeHost.run()
            return
        }
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
    /// Open ScreenFry's settings page in each browser, shown once ScreenFry runs there.
    private lazy var safariOpenButton = openSettingsButton(tag: 0)
    private lazy var chromeOpenButton = openSettingsButton(tag: 1)
    private var chromeDropAccepted = false
    private var chromePreparationError: String?
    private lazy var chromeConfirmation = NSButton(checkboxWithTitle: "ScreenFry appears in Chrome’s Extensions page", target: self, action: #selector(confirmChromeSetup(_:)))
    private static let chromeConfirmedKey = "chromeSetupConfirmedByUser"
    /// Set to false in project.yml when the public Safari distribution is ready.
    private static var showsSafariDeveloperSetup: Bool {
        Bundle.main.object(forInfoDictionaryKey: "ScreenFryShowSafariDeveloperSetup") as? Bool ?? true
    }
    private let notice = NSTextField(wrappingLabelWithString: "")
    private lazy var ejectButton: NSButton = {
        let b = button("Eject Installer", #selector(ejectInstaller(_:)), primary: false)
        // A rounded square, not a pill (Sam's request).
        if #available(macOS 26.0, *) { b.borderShape = .roundedRectangle }
        return b
    }()
    private var installerVolume: URL?
    private var transferStatus: [SettingsBrowser: NSTextField] = [:]
    /// This Mac's loadouts, sent to every browser.
    private lazy var loadoutsPanel = AppLoadoutsPanel(browsers: transferBrowsers, window: window)
    /// Safari's setup steps, folded away once ScreenFry is on in Safari.
    private let safariSteps = NSStackView()
    private lazy var safariStepsToggle: NSButton = {
        let b = NSButton(title: "Show setup steps", target: self, action: #selector(toggleSafariSteps(_:)))
        b.bezelStyle = .inline
        b.isHidden = true
        return b
    }()
    private var safariStepsShownByUser = false
    /// Chrome's setup steps, folded away once ScreenFry in Chrome has checked in.
    private let chromeSteps = NSStackView()
    private lazy var chromeStepsToggle: NSButton = {
        let b = NSButton(title: "Show setup steps", target: self, action: #selector(toggleChromeSteps(_:)))
        b.bezelStyle = .inline
        return b
    }()
    private var chromeStepsShownByUser = false
    private var transferTimer: Timer?
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

    /// Started by logging in: stay in the menu bar without opening the window.
    private var launchedAtLogin = false
    private var menuBar: MenuBarItem?

    func applicationWillFinishLaunching(_ notification: Notification) {
        launchedAtLogin = LoginItem.launchedAtLogin()
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
        // The menu bar icon keeps ScreenFry running (and checking for updates) after its
        // window closes; it starts at login unless that's turned off.
        menuBar = MenuBarItem(
            onOpen: { [weak self] in self?.showMainWindow() },
            onCheckForUpdates: { [weak self] in self?.checkForUpdates(nil) },
            autoUpdateState: { [weak self] in self?.autoUpdateOn },
            onToggleAutoUpdate: { [weak self] in self?.toggleAutoUpdate(nil) },
            onToggleLogin: { [weak self] in self?.toggleLogin(nil) })
        LoginItem.turnOnByDefaultOnce()
        loginBox.state = LoginItem.isEnabled ? .on : .off
        if launchedAtLogin { NSApp.setActivationPolicy(.accessory) }
        installChromeExtension()
        warnAboutOtherCopies()
        refreshState()
        // Browsers check in about once a minute; keep their status current.
        transferTimer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in
            self?.refreshTransferStatus()
            self?.refreshChromeStatus()
        }
    }

    func applicationDidBecomeActive(_ notification: Notification) { refreshState() }
    /// Closing the window keeps ScreenFry in the menu bar (and out of the Dock).
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    /// Opening ScreenFry again (Finder, Spotlight, the Dock) shows its window.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showMainWindow()
        return true
    }

    private func showMainWindow() {
        guard let window else { return }
        NSApp.setActivationPolicy(.regular)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        refreshState()
    }

    /// "Start at login", in the window and the menu bar menu.
    private lazy var loginBox: NSButton = {
        let b = NSButton(checkboxWithTitle: "Start at login", target: self, action: #selector(toggleLogin(_:)))
        b.font = .systemFont(ofSize: 11)
        b.toolTip = "Start ScreenFry in the menu bar when you log in, so it can check for updates."
        return b
    }()

    @objc private func toggleLogin(_ sender: Any?) {
        let on = !LoginItem.isEnabled
        do {
            try LoginItem.set(on)
        } catch {
            if on, SMAppService.mainApp.status == .requiresApproval {
                SMAppService.openSystemSettingsLoginItems()
            } else {
                showAlert("Couldn’t change Start at Login", error.localizedDescription)
            }
        }
        loginBox.state = LoginItem.isEnabled ? .on : .off
    }

    private var autoUpdateOn: Bool? {
        #if canImport(Sparkle)
        return Self.updatesConfigured ? updater.updater.automaticallyDownloadsUpdates : nil
        #else
        return nil
        #endif
    }

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
            // Only say what's known: a ScreenFry disk image is mounted. It may be one you haven't
            // installed from yet, so don't claim it's finished or which version it holds.
            notice.stringValue = "A ScreenFry installer disk is still mounted. Eject it when you’re done with it."
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
        guard chromeIsInstalled else { return }
        do {
            try ChromeNativeHost.register()
        } catch {
            NSLog("ScreenFry: couldn’t register Chrome settings transfer: \(error.localizedDescription)")
        }
    }

    private var chromeIsInstalled: Bool {
        NSWorkspace.shared.urlForApplication(withBundleIdentifier: Self.chromeBundleID) != nil
    }

    /// Browsers that can have ScreenFry settings on this Mac.
    private var transferBrowsers: [SettingsBrowser] {
        SettingsBrowser.allCases.filter { $0 != .chrome || chromeIsInstalled }
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
        // Closed windows are kept, so the menu bar icon can show this one again.
        window.isReleasedWhenClosed = false
        NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: window, queue: .main) { _ in
            // Only the menu bar icon is left: no Dock icon until the window opens again.
            NSApp.setActivationPolicy(.accessory)
        }
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
        let about = NSButton(title: "About", target: self, action: #selector(showAbout(_:)))
        about.bezelStyle = .rounded
        about.bezelColor = Self.ember
        about.toolTip = "About ScreenFry"
        let spacer = NSView()
        spacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
        let header = NSStackView(views: [logo, titles, spacer, about])
        header.orientation = .horizontal
        header.alignment = .centerY
        header.spacing = 14

        notice.font = .systemFont(ofSize: 12, weight: .medium)
        notice.textColor = .systemOrange
        notice.isHidden = true
        notice.preferredMaxLayoutWidth = 360

        var safariStepRows: [NSView] = [
            stepRow(1, "Open Safari’s settings."),
            button("Open Safari Settings", #selector(openSafariSettings(_:)), primary: true),
        ]
        if Self.showsSafariDeveloperSetup {
            safariStepRows.append(stepRow(2, "In Advanced, turn on “Show features for web developers”. Open the Developer tab, then turn on “Allow unsigned extensions”. Repeat after restarting Safari.", bold: "Show features for web developers"))
        }
        let enableStep = Self.showsSafariDeveloperSetup ? 3 : 2
        safariStepRows += [
            stepRow(enableStep, "Go to Extensions and check the box beside ScreenFry."),
            stepRow(enableStep + 1, "When the website-access popup appears, check “Remember for other websites”, then press “Always Allow”.", bold: "Remember for other websites"),
            helperLabel("Already enabled? In Edit Websites, set Other Websites to Allow. Optional: turn on Allow in Private Browsing."),
        ]
        safariSteps.orientation = .vertical
        safariSteps.alignment = .leading
        safariSteps.spacing = 10
        safariStepRows.forEach { safariSteps.addArrangedSubview($0) }
        safariStepRows.forEach { row in
            if row is NSStackView || row is NSTextField {
                row.widthAnchor.constraint(equalTo: safariSteps.widthAnchor).isActive = true
            }
        }
        let safariRows: [NSView] = [safariStepsToggle, safariSteps] + transferRows(.safari)
        let safari = card(title: "Safari", dot: safariDot, status: safariStatus, rows: safariRows, accessory: safariOpenButton)

        let chromeInstalled = chromeIsInstalled
        var chromeRows: [NSView] = []
        if chromeInstalled {
            let tile = DragTile(folder: ChromeInstaller.folder)
            tile.onDropAccepted = { [weak self] in
                self?.chromeDropAccepted = true
                self?.refreshState()
            }
            chromeConfirmation.state = UserDefaults.standard.bool(forKey: Self.chromeConfirmedKey) ? .on : .off
            let steps: [NSView] = [
                stepRow(1, "Open the Extensions page.", action: button("Open Chrome Extensions", #selector(openChromeExtensions(_:)), primary: true)),
                stepRow(2, "Turn on Developer mode (top-right switch on that page).", bold: "top-right switch"),
                developerModeScreenshots(),
                stepRow(3, "Drag this tile onto the Extensions page. Or click it to show the folder, then select that folder with Load unpacked."),
                tile,
                chromeConfirmation,
                helperLabel("Pin ScreenFry from Chrome’s puzzle-piece menu. Once ScreenFry runs in Chrome it checks in with this app, and this card shows it’s connected."),
            ]
            chromeSteps.orientation = .vertical
            chromeSteps.alignment = .leading
            chromeSteps.spacing = 10
            steps.forEach { chromeSteps.addArrangedSubview($0) }
            steps.forEach { row in
                if row is NSStackView || row is DragTile || row is NSTextField {
                    row.widthAnchor.constraint(equalTo: chromeSteps.widthAnchor).isActive = true
                }
            }
            chromeRows = [chromeStepsToggle, chromeSteps] + transferRows(.chrome)
        } else {
            chromeRows = [helperLabel("Google Chrome isn’t installed. Install it, then reopen ScreenFry to set it up.")]
        }
        let chrome = card(title: "Chrome", dot: chromeDot, status: chromeStatus, rows: chromeRows, accessory: chromeInstalled ? chromeOpenButton : nil)

        let request = NSButton(title: "Browser not listed here? Press here to request a new one.", target: self, action: #selector(requestBrowser(_:)))
        request.isBordered = false
        request.alignment = .left
        let requestText = NSMutableAttributedString(string: request.title, attributes: [.font: NSFont.systemFont(ofSize: 12), .foregroundColor: NSColor.secondaryLabelColor])
        requestText.addAttributes([.underlineStyle: NSUnderlineStyle.single.rawValue, .foregroundColor: NSColor.linkColor], range: (request.title as NSString).range(of: "Press here"))
        request.attributedTitle = requestText
        request.toolTip = "Open a browser request on GitHub (you review and submit it)."
        let loadouts = card(
            title: "Loadouts",
            dot: NSView(),
            status: NSTextField(labelWithString: "For every browser"),
            rows: loadoutsPanel.makeRows(button: { self.button($0, $1, primary: $2) }, helper: { self.helperLabel($0) }))
        let browsers = NSStackView(views: [safari, chrome, loadouts, request])
        browsers.orientation = .vertical
        browsers.alignment = .leading
        browsers.spacing = 14
        browsers.edgeInsets = NSEdgeInsets(top: 14, left: 14, bottom: 14, right: 14)
        browsers.wantsLayer = true
        browsers.layer?.cornerRadius = 16
        browsers.layer?.backgroundColor = NSColor.quaternaryLabelColor.withAlphaComponent(0.08).cgColor
        safari.widthAnchor.constraint(equalTo: browsers.widthAnchor, constant: -28).isActive = true
        chrome.widthAnchor.constraint(equalTo: safari.widthAnchor).isActive = true
        loadouts.widthAnchor.constraint(equalTo: safari.widthAnchor).isActive = true

        ejectButton.isHidden = true
        let noticeRow = NSStackView(views: [notice, ejectButton])
        noticeRow.orientation = .horizontal
        noticeRow.alignment = .centerY
        noticeRow.spacing = 10
        let uninstallButton = NSButton(title: "Uninstall…", target: self, action: #selector(uninstall(_:)))
        uninstallButton.bezelStyle = .inline
        let resetAll = NSButton(title: "Reset All Data…", target: self, action: #selector(resetAllData(_:)))
        resetAll.bezelStyle = .inline
        resetAll.toolTip = "Restore ScreenFry’s defaults in every browser: settings, loadouts, usage and settings passwords."
        // Bottom right: updates, and whether ScreenFry installs them and starts at login.
        let options = NSStackView(views: [autoUpdateBox, loginBox])
        options.orientation = .vertical
        options.alignment = .leading
        options.spacing = 2
        let footerSpacer = NSView()
        footerSpacer.setContentHuggingPriority(NSLayoutConstraint.Priority(1), for: .horizontal)
        let footer = NSStackView(views: [uninstallButton, resetAll, footerSpacer, options, updateButton])
        footer.orientation = .horizontal
        footer.distribution = .fill
        footer.alignment = .centerY
        footer.spacing = 10
        let stack = NSStackView(views: [header, noticeRow, browsers, footer])
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
            footer.widthAnchor.constraint(equalTo: stack.widthAnchor),
            browsers.widthAnchor.constraint(equalTo: stack.widthAnchor),
        ])
        let availableHeight = (NSScreen.main?.visibleFrame.height ?? 900) - 60
        window.setContentSize(NSSize(width: 660, height: min(900, availableHeight)))
        window.center()
        // Started at login: only the menu bar icon, no window.
        guard !launchedAtLogin else { return }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    /// A rounded section with a title, status dot, numbered steps and buttons.
    private func card(title: String, dot: NSView, status: NSTextField, rows: [NSView], accessory: NSView? = nil) -> NSView {
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
        // The spacer takes the slack so the accessory button sits at the right edge.
        let spacer = NSView()
        spacer.setContentHuggingPriority(NSLayoutConstraint.Priority(1), for: .horizontal)
        spacer.setContentCompressionResistancePriority(NSLayoutConstraint.Priority(1), for: .horizontal)
        let top = NSStackView(views: [heading, statusRow, spacer] + (accessory.map { [$0] } ?? []))
        top.orientation = .horizontal
        top.distribution = .fill
        top.alignment = .centerY
        top.spacing = 12

        let stack = NSStackView(views: [top] + rows)
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 10
        rows.forEach { row in
            if row is NSStackView || row is DragTile || row is NSTextField || row is NSBox {
                row.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
            }
        }
        top.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
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

    /// Developer mode off → on, as Chrome shows it. Both pictures open Chrome's Extensions page.
    private func developerModeScreenshots() -> NSView {
        func screenshot(_ name: String, caption: String) -> NSButton {
            let b = NSButton(image: NSImage(named: name) ?? NSImage(), target: self, action: #selector(openChromeExtensions(_:)))
            b.isBordered = false
            b.imageScaling = .scaleProportionallyUpOrDown
            b.toolTip = "Open Chrome’s Extensions page"
            b.setAccessibilityLabel("Chrome Extensions: Developer mode \(caption.lowercased()). Opens Chrome’s Extensions page.")
            b.wantsLayer = true
            b.layer?.cornerRadius = 8
            b.layer?.borderWidth = 1
            b.layer?.borderColor = NSColor.separatorColor.cgColor
            b.layer?.masksToBounds = true
            b.translatesAutoresizingMaskIntoConstraints = false
            // Sized to the picture itself, so the border hugs it with no grey margins.
            let size = b.image?.size ?? NSSize(width: 340, height: 112)
            let height: CGFloat = 60
            b.imageScaling = .scaleAxesIndependently
            b.widthAnchor.constraint(equalToConstant: (height * size.width / max(size.height, 1)).rounded()).isActive = true
            b.heightAnchor.constraint(equalToConstant: height).isActive = true
            return b
        }
        let arrow = NSImageView()
        let config = NSImage.SymbolConfiguration(pointSize: 30, weight: .semibold)
            .applying(.init(paletteColors: [.white, Self.ember]))
        arrow.image = NSImage(systemSymbolName: "arrow.right.circle.fill", accessibilityDescription: "then")?
            .withSymbolConfiguration(config)
        arrow.shadow = {
            let shadow = NSShadow()
            shadow.shadowColor = Self.ember.withAlphaComponent(0.35)
            shadow.shadowBlurRadius = 6
            shadow.shadowOffset = NSSize(width: 0, height: -1)
            return shadow
        }()
        let grid = NSGridView(views: [
            [screenshot("ChromeDeveloperModeOff", caption: "Before: off"), arrow, screenshot("ChromeDeveloperModeOn", caption: "After: on")],
            [helperLabel("Before: off"), NSGridCell.emptyContentView, helperLabel("After: on")],
        ])
        grid.columnSpacing = 14
        grid.rowSpacing = 4
        grid.column(at: 1).xPlacement = .center
        grid.row(at: 0).yPlacement = .center
        return grid
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
        refreshTransferStatus()
        refreshChromeStatus()
        refreshSafariStatus()
    }

    private func refreshChromeStatus() {
        let chromeCheckIn = SettingsTransfer.checkIn(.chrome)
        chromeSteps.isHidden = chromeCheckIn != nil && !chromeStepsShownByUser
        chromeStepsToggle.isHidden = chromeCheckIn == nil
        chromeOpenButton.isHidden = chromeCheckIn == nil
        chromeStepsToggle.title = chromeSteps.isHidden ? "Show setup steps" : "Hide setup steps"
        if let error = chromePreparationError {
            chromeStatus.stringValue = "Couldn’t prepare Chrome: \(error)"
            chromeDot.layer?.backgroundColor = NSColor.systemOrange.cgColor
        } else if let checkIn = chromeCheckIn {
            // Proof from Chrome itself. An app update lands once Chrome runs: the extension
            // reloads when it sees the new build (Chrome must be open for that).
            let current = checkIn.version.isEmpty || checkIn.version == version
            chromeStatus.stringValue = current
                ? "Connected · ScreenFry \(checkIn.version.isEmpty ? version : checkIn.version)"
                : "Connected · updating to \(version) (open Chrome to complete)"
            chromeDot.layer?.backgroundColor = (current ? NSColor.systemGreen : NSColor.systemOrange).cgColor
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
    }

    private func refreshSafariStatus() {
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionIdentifier) { [weak self] state, error in
            DispatchQueue.main.async {
                guard let self else { return }
                self.safariOpenButton.isHidden = state?.isEnabled != true
                // Once ScreenFry is on, its setup steps fold away behind "Show setup steps".
                let on = state?.isEnabled == true
                self.safariSteps.isHidden = on && !self.safariStepsShownByUser
                self.safariStepsToggle.isHidden = !on
                self.safariStepsToggle.title = self.safariSteps.isHidden ? "Show setup steps" : "Hide setup steps"
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

    private func openSettingsButton(tag: Int) -> NSButton {
        let b = button("Open ScreenFry Settings", #selector(openScreenFrySettings(_:)), primary: true)
        b.controlSize = .regular
        // A pill, not a square (Sam's request).
        if #available(macOS 26.0, *) { b.borderShape = .capsule }
        b.tag = tag
        b.isHidden = true
        b.toolTip = "Opens ScreenFry’s settings page in this browser."
        return b
    }

    /// Chrome opens ScreenFry's settings page by its own address (its id, as reported at
    /// check-in or worked out from the folder Chrome loads it from). Safari's extension
    /// address changes per install, so Safari gets an address that never loads (`.invalid` is
    /// reserved) and ScreenFry there swaps the tab for its settings page.
    @objc private func openScreenFrySettings(_ sender: NSButton) {
        let chrome = sender.tag == 1
        let bundleID = chrome ? Self.chromeBundleID : "com.apple.Safari"
        let address = chrome
            ? "chrome-extension://\(SettingsTransfer.extensionId(.chrome) ?? ChromeInstaller.unpackedExtensionId)/dashboard.html#settings"
            : "https://open.screenfry.invalid/settings"
        guard let app = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID),
              let page = URL(string: address) else { return }
        NSWorkspace.shared.open([page], withApplicationAt: app, configuration: NSWorkspace.OpenConfiguration()) { _, error in
            if let error { NSLog("ScreenFry: unable to open settings: \(error.localizedDescription)") }
        }
    }

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

    @objc private func showAbout(_ sender: Any?) {
        guard let window, window.attachedSheet == nil else { return }
        AboutWindow.show(on: window, version: version, ember: Self.ember)
    }

    @objc private func toggleSafariSteps(_ sender: Any?) {
        safariStepsShownByUser = safariSteps.isHidden
        safariSteps.isHidden.toggle()
        safariStepsToggle.title = safariSteps.isHidden ? "Show setup steps" : "Hide setup steps"
    }

    @objc private func toggleChromeSteps(_ sender: Any?) {
        chromeStepsShownByUser = chromeSteps.isHidden
        refreshState()
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

    /// "Install updates automatically": Sparkle downloads new versions in the background and
    /// installs them when ScreenFry quits (it still checks, and asks, when this is off).
    private lazy var autoUpdateBox: NSButton = {
        let b = NSButton(checkboxWithTitle: "Install updates automatically", target: self, action: #selector(toggleAutoUpdate(_:)))
        b.font = .systemFont(ofSize: 11)
        b.isHidden = !Self.updatesConfigured
        #if canImport(Sparkle)
        b.state = Self.updatesConfigured && updater.updater.automaticallyDownloadsUpdates ? .on : .off
        #endif
        b.toolTip = "ScreenFry checks for a new version every few hours. With this on, it downloads it and installs it the next time ScreenFry quits."
        return b
    }()
    private var autoUpdateMenuItem: NSMenuItem?

    @objc private func toggleAutoUpdate(_ sender: Any?) {
        #if canImport(Sparkle)
        guard Self.updatesConfigured else { return }
        let on = !updater.updater.automaticallyDownloadsUpdates
        updater.updater.automaticallyChecksForUpdates = true
        updater.updater.automaticallyDownloadsUpdates = on
        autoUpdateBox.state = on ? .on : .off
        autoUpdateMenuItem?.state = on ? .on : .off
        #endif
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

    // MARK: Browser connection

    /// The bottom of a browser card: whether ScreenFry there has connected, and any reset.
    private func transferRows(_ browser: SettingsBrowser) -> [NSView] {
        let separator = NSBox()
        separator.boxType = .separator
        let status = helperLabel("")
        transferStatus[browser] = status
        return [separator, status]
    }

    private func refreshTransferStatus() {
        loadoutsPanel.refresh()
        let relative = RelativeDateTimeFormatter()
        relative.unitsStyle = .full
        func ago(_ date: Date) -> String {
            Date().timeIntervalSince(date) < 60 ? "just now" : relative.localizedString(for: date, relativeTo: Date())
        }
        for (browser, label) in transferStatus {
            var lines: [String] = []
            if let checkIn = SettingsTransfer.checkIn(browser) {
                lines.append("ScreenFry in \(browser.name) last checked in \(ago(checkIn.at)).")
            } else {
                lines.append("Not connected yet. Open \(browser.name) with ScreenFry turned on; it checks in with this app about once a minute.")
            }
            if SettingsTransfer.pendingReset(browser) {
                lines.append("Reset waiting: ScreenFry in \(browser.name) restores its defaults the next time it checks in.")
            } else if let result = SettingsTransfer.lastResetResult(browser), let at = result.at,
                      Date().timeIntervalSince(at) < 3600 {
                lines.append(result.ok
                    ? "Reset to defaults \(ago(at))."
                    : "\(browser.name) didn’t reset: \(result.error ?? "unknown error")")
            }
            label.stringValue = lines.joined(separator: " ")
        }
    }

    // MARK: Reset

    /// Restores ScreenFry's defaults in every connected browser, through each browser's own
    /// copy (only it can change its storage). A browser with a settings password refuses, so
    /// the password keeps protecting it: reset that one from its own Settings page instead.
    @objc private func resetAllData(_ sender: Any?) {
        let connected = transferBrowsers.filter { SettingsTransfer.checkIn($0) != nil }
        guard !connected.isEmpty else {
            showAlert("Nothing to reset yet", "No browser has connected to ScreenFry on this Mac. Open a browser with ScreenFry turned on, wait a minute, then try again.")
            return
        }
        let protected = connected.filter { SettingsTransfer.checkIn($0)?.passwordProtected == true }
        let names = connected.map(\.name).joined(separator: " and ")
        let confirm = NSAlert()
        confirm.messageText = "Reset ScreenFry in \(names)?"
        var detail = "Every website setting, window, limit, feed switch, goal and loadout (in the browsers and on this Mac), all usage and any settings password are erased, as if ScreenFry were just installed. This can’t be undone. Copy a share code first if you want to keep a setup."
        if !protected.isEmpty {
            detail += "\n\n\(protected.map(\.name).joined(separator: " and ")) has a settings password, so it won’t reset from here. Use Restore defaults in ScreenFry’s Settings there; it asks for the password."
        }
        confirm.informativeText = detail
        confirm.addButton(withTitle: "Reset All Data")
        confirm.addButton(withTitle: "Cancel")
        confirm.buttons[0].hasDestructiveAction = true
        guard confirm.runModal() == .alertFirstButtonReturn else { return }
        // This Mac's own loadouts go too.
        AppLoadouts.clear()
        loadoutsPanel.refresh()
        var failures: [String] = []
        for browser in connected {
            do {
                try SettingsTransfer.queueReset(browser)
            } catch {
                failures.append("\(browser.name): \(error.localizedDescription)")
            }
        }
        refreshTransferStatus()
        if !failures.isEmpty { showAlert("Couldn’t ask for a reset", failures.joined(separator: "\n")) }
    }

    private func showAlert(_ title: String, _ message: String) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = message
        alert.runModal()
    }

    // MARK: Uninstall

    @objc private func uninstall(_ sender: Any?) {
        let alert = NSAlert()
        alert.messageText = "Uninstall ScreenFry?"
        alert.informativeText = """
        Keep Settings removes the app and its extensions’ files. Safari and Chrome keep \
        ScreenFry’s settings (and Safari keeps it switched on), so reinstalling picks them \
        up again.

        Erase Everything removes every trace: ScreenFry in Safari and Chrome first wipes \
        its settings, windows, usage and password (each browser is opened in the background \
        if it’s closed, and Chrome also removes the extension). You then switch ScreenFry off \
        in Safari’s settings, the one thing only you can do, and ScreenFry’s files and \
        preferences on this Mac are deleted.
        """
        alert.addButton(withTitle: "Keep Settings")
        alert.addButton(withTitle: "Erase Everything")
        alert.addButton(withTitle: "Cancel")
        alert.buttons[1].hasDestructiveAction = true
        let choice = alert.runModal()
        guard choice != .alertThirdButtonReturn else { return }
        guard choice == .alertSecondButtonReturn else {
            performUninstall(erase: false, erased: [])
            return
        }
        // Only ScreenFry inside each browser can clear that browser's storage, so ask every
        // browser it has connected from.
        let connected = transferBrowsers.filter { SettingsTransfer.checkIn($0) != nil }
        guard !connected.isEmpty else {
            finishErase(erased: [])
            return
        }
        eraseInBrowsers(connected) { [weak self] erased in
            guard let self else { return }
            let missing = connected.filter { !erased.contains($0) }
            guard !missing.isEmpty else { return self.finishErase(erased: erased) }
            let names = missing.map(\.name).joined(separator: " and ")
            let ask = NSAlert()
            ask.messageText = "\(names) didn’t answer"
            ask.informativeText = "ScreenFry’s settings in \(names) are only cleared by ScreenFry there, and it didn’t check in. Open \(names) with ScreenFry turned on and try again, or uninstall anyway and use Restore defaults in ScreenFry’s Settings there first next time."
            ask.addButton(withTitle: "Try Again")
            ask.addButton(withTitle: "Uninstall Anyway")
            ask.addButton(withTitle: "Cancel")
            switch ask.runModal() {
            case .alertFirstButtonReturn: self.uninstallEraseRetry(erased: erased, remaining: missing)
            case .alertSecondButtonReturn: self.finishErase(erased: erased)
            default: break
            }
        }
    }

    private func uninstallEraseRetry(erased: Set<SettingsBrowser>, remaining: [SettingsBrowser]) {
        // A second try uninstalls either way; the closing note says what was left.
        eraseInBrowsers(remaining) { [weak self] more in
            self?.finishErase(erased: erased.union(more))
        }
    }

    /// Hands each browser's ScreenFry the request to erase itself, starting a closed browser in
    /// the background so it checks in, then waits (up to a minute and a half) for each to pick
    /// it up. Chrome also removes the extension, so nothing stays on its Extensions page.
    private func eraseInBrowsers(_ browsers: [SettingsBrowser], _ done: @escaping (Set<SettingsBrowser>) -> Void) {
        for browser in browsers {
            SettingsTransfer.requestErase(browser)
            if NSRunningApplication.runningApplications(withBundleIdentifier: browser.bundleID).isEmpty,
               let app = NSWorkspace.shared.urlForApplication(withBundleIdentifier: browser.bundleID) {
                let configuration = NSWorkspace.OpenConfiguration()
                configuration.activates = false
                configuration.hides = true
                NSWorkspace.shared.openApplication(at: app, configuration: configuration) { _, _ in }
            }
        }
        let names = browsers.map(\.name).joined(separator: " and ")
        let progress = NSAlert()
        progress.messageText = "Erasing ScreenFry in \(names)…"
        progress.informativeText = "ScreenFry in each browser wipes its settings the next time it checks in, within about a minute."
        let spinner = NSProgressIndicator(frame: NSRect(x: 0, y: 0, width: 24, height: 24))
        spinner.style = .spinning
        spinner.startAnimation(nil)
        progress.accessoryView = spinner
        progress.addButton(withTitle: "Skip")
        let started = Date()
        let answered = { Set(browsers.filter(SettingsTransfer.eraseSent)) }
        let timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] timer in
            guard let self else { return }
            if answered().count == browsers.count {
                timer.invalidate()
                // Give each browser a moment to finish before the app goes away.
                DispatchQueue.main.asyncAfter(deadline: .now() + 2) { self.window.endSheet(progress.window) }
            } else if Date().timeIntervalSince(started) > 90 {
                timer.invalidate()
                self.window.endSheet(progress.window)
            }
        }
        progress.beginSheetModal(for: window) { _ in
            timer.invalidate()
            done(answered())
        }
    }

    /// Erase Everything's last step before deleting files. Safari remembers which extensions
    /// were switched on, even after their app is deleted, in a folder no app may change, so
    /// a reinstall would start switched on. Only the user can switch it off: open Safari's
    /// Extensions settings and carry on by itself the moment ScreenFry is off. When Safari
    /// can't say (it sometimes doesn't answer), the step is shown anyway, and finishing while
    /// ScreenFry is still on asks first instead of passing silently.
    private func finishErase(erased: Set<SettingsBrowser>) {
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionIdentifier) { [weak self] state, _ in
            DispatchQueue.main.async {
                guard let self else { return }
                if state?.isEnabled == false { return self.performUninstall(erase: true, erased: erased) }
                self.openSafariSettings(nil)
                let progress = NSAlert()
                progress.messageText = "Last step: turn ScreenFry off in Safari"
                progress.informativeText = "Safari remembers which extensions you switched on, even after an app is deleted, and only you can change that. In Safari’s Extensions settings, uncheck ScreenFry. Uninstalling carries on by itself once it’s off, so a future install starts switched off."
                let spinner = NSProgressIndicator(frame: NSRect(x: 0, y: 0, width: 24, height: 24))
                spinner.style = .spinning
                spinner.startAnimation(nil)
                progress.accessoryView = spinner
                progress.addButton(withTitle: "Open Safari Settings")
                progress.addButton(withTitle: "Done")
                var finished = false
                let timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] timer in
                    guard let self else { return timer.invalidate() }
                    SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: self.extensionIdentifier) { state, _ in
                        DispatchQueue.main.async {
                            guard state?.isEnabled == false, !finished else { return }
                            finished = true
                            timer.invalidate()
                            self.window.endSheet(progress.window, returnCode: .alertSecondButtonReturn)
                        }
                    }
                }
                func show() {
                    progress.beginSheetModal(for: self.window) { [weak self] response in
                        guard let self else { return }
                        if response == .alertFirstButtonReturn {
                            // Reopen the settings and keep waiting.
                            self.openSafariSettings(nil)
                            DispatchQueue.main.async { show() }
                            return
                        }
                        if finished { return self.performUninstall(erase: true, erased: erased) }
                        // "Done" while Safari still has ScreenFry on (or won't say): check first.
                        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: self.extensionIdentifier) { state, _ in
                            DispatchQueue.main.async {
                                if state?.isEnabled == false {
                                    finished = true
                                    timer.invalidate()
                                    return self.performUninstall(erase: true, erased: erased)
                                }
                                let warn = NSAlert()
                                warn.messageText = state == nil
                                    ? "Is ScreenFry unchecked in Safari?"
                                    : "ScreenFry is still on in Safari"
                                warn.informativeText = "If it stays checked, Safari remembers it, and installing ScreenFry again starts with it already switched on."
                                warn.addButton(withTitle: "Go Back")
                                warn.addButton(withTitle: "Uninstall Anyway")
                                if warn.runModal() == .alertSecondButtonReturn {
                                    finished = true
                                    timer.invalidate()
                                    self.performUninstall(erase: true, erased: erased)
                                } else {
                                    show()
                                }
                            }
                        }
                    }
                }
                show()
            }
        }
    }

    private func performUninstall(erase: Bool, erased: Set<SettingsBrowser>) {
        // No more starting at login or menu bar icon once it's gone.
        try? LoginItem.set(false)
        menuBar?.remove()
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
        var paths = [
            ChromeInstaller.folder.deletingLastPathComponent(), // Application Support/ScreenFry
            ChromeNativeHost.manifestURL,
        ]
        if erase {
            paths += [
                home.appendingPathComponent("Library/Caches/\(id)"),
                home.appendingPathComponent("Library/HTTPStorages/\(id)"),
                home.appendingPathComponent("Library/Saved Application State/\(id).savedState"),
                SettingsBrowser.safari.bridge.directory.deletingLastPathComponent(), // Safari's settings handoff
                // macOS may keep these extension folders; remove what it allows.
                home.appendingPathComponent("Library/Containers/\(extensionIdentifier)"),
                home.appendingPathComponent("Library/Application Scripts/\(extensionIdentifier)"),
            ]
            // Clearing the domain leaves an empty preferences file behind; remove it too.
            UserDefaults.standard.removePersistentDomain(forName: id)
            CFPreferencesAppSynchronize(id as CFString)
            paths.append(home.appendingPathComponent("Library/Preferences/\(id).plist"))
            // An installer disk still mounted would keep a copy of the app (and its Safari
            // extension) visible to macOS.
            for volume in fm.mountedVolumeURLs(includingResourceValuesForKeys: nil, options: [.skipHiddenVolumes]) ?? []
            where volume.path.hasPrefix("/Volumes/")
                && fm.fileExists(atPath: volume.appendingPathComponent("ScreenFry.app").path)
                && !Bundle.main.bundlePath.hasPrefix(volume.path + "/") {
                try? NSWorkspace.shared.unmountAndEjectDevice(at: volume)
            }
        }
        for path in paths where fm.fileExists(atPath: path.path) {
            try? fm.removeItem(at: path)
        }
        let chromeLeft = erase && !erased.contains(.chrome) && chromeIsInstalled
        if chromeLeft { openChromeExtensions(nil) }
        let erasedNames = erased.map(\.name).sorted().joined(separator: " and ")
        // macOS protects the Safari extension's own folder from every app; only Finder can
        // move it. Show it so the user can drag it to the Trash.
        let container = home.appendingPathComponent("Library/Containers/\(extensionIdentifier)")
        let containerLeft = erase && fm.fileExists(atPath: container.path)
        if containerLeft { NSWorkspace.shared.activateFileViewerSelecting([container]) }
        NSWorkspace.shared.recycle([Bundle.main.bundleURL]) { _, error in
            DispatchQueue.main.async {
                let done = NSAlert()
                let finder = containerLeft
                    ? " One last step: drag the selected “\(container.lastPathComponent)” folder in Finder to the Trash. macOS only lets you remove that one yourself."
                    : ""
                if let error {
                    done.messageText = "Almost done"
                    done.informativeText = "ScreenFry’s data was removed, but the app couldn’t move itself to the Trash (\(error.localizedDescription)). Drag ScreenFry from Applications to the Trash.\(finder)"
                } else {
                    done.messageText = containerLeft ? "Almost done" : "ScreenFry is uninstalled"
                    done.informativeText = !erase
                        ? "Reinstall any time; Safari and Chrome keep your ScreenFry settings."
                        : chromeLeft
                            ? "If ScreenFry is still on Chrome’s Extensions page, click Remove to delete its settings there.\(finder)"
                            : "ScreenFry was removed from this Mac\(erased.isEmpty ? "" : ", and its settings were wiped in \(erasedNames)").\(finder)"
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
        let aboutItem = NSMenuItem(title: "About ScreenFry", action: #selector(showAbout(_:)), keyEquivalent: "")
        aboutItem.target = self
        appMenu.addItem(aboutItem)
        let update = NSMenuItem(title: "Check for Updates…", action: #selector(checkForUpdates(_:)), keyEquivalent: "")
        update.target = self
        appMenu.addItem(update)
        if Self.updatesConfigured {
            let auto = NSMenuItem(title: "Install Updates Automatically", action: #selector(toggleAutoUpdate(_:)), keyEquivalent: "")
            auto.target = self
            #if canImport(Sparkle)
            auto.state = updater.updater.automaticallyDownloadsUpdates ? .on : .off
            #endif
            appMenu.addItem(auto)
            autoUpdateMenuItem = auto
        }
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

import AppKit
import ServiceManagement

/// ScreenFry as a login item: started when you log in, in the menu bar with no window, so
/// it can check for updates (and keep the browsers' status) without being opened.
enum LoginItem {
    static var isEnabled: Bool { SMAppService.mainApp.status == .enabled }

    /// Turns starting at login on or off; macOS shows its own notice the first time.
    static func set(_ on: Bool) throws {
        if on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
    }

    /// Whether this launch came from logging in (read before the app finishes launching).
    static func launchedAtLogin() -> Bool {
        guard let event = NSAppleEventManager.shared().currentAppleEvent,
              event.eventID == AEEventID(kAEOpenApplication)
        else { return false }
        return event.paramDescriptor(forKeyword: AEKeyword(keyAEPropData))?.enumCodeValue == OSType(keyAELaunchedAsLogInItem)
    }

    private static let offeredKey = "loginItemTurnedOnByDefault"
    /// The first time ScreenFry runs from Applications it starts at login, so updates and the
    /// menu bar icon are there without opening it. The menu and the window can turn it off.
    static func turnOnByDefaultOnce() {
        guard !UserDefaults.standard.bool(forKey: offeredKey),
              Bundle.main.bundlePath.hasPrefix("/Applications/")
        else { return }
        UserDefaults.standard.set(true, forKey: offeredKey)
        try? set(true)
    }
}

/// The menu bar icon: ScreenFry stays running there after its window closes.
final class MenuBarItem: NSObject, NSMenuDelegate {
    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    private let onOpen: () -> Void
    private let onCheckForUpdates: () -> Void
    private let onToggleAutoUpdate: () -> Void
    private let onToggleLogin: () -> Void
    private let autoUpdateState: () -> Bool?
    private var autoUpdate: NSMenuItem!
    private var login: NSMenuItem!
    private var updateItem: NSMenuItem!
    /// ScreenFry's logo as a silhouette, colored by macOS like the other menu bar icons.
    private let icon: NSImage? = {
        let image = NSImage(named: "MenuBarIcon")
        image?.isTemplate = true
        image?.size = NSSize(width: 18, height: 18)
        return image
    }()

    init(
        onOpen: @escaping () -> Void,
        onCheckForUpdates: @escaping () -> Void,
        autoUpdateState: @escaping () -> Bool?,
        onToggleAutoUpdate: @escaping () -> Void,
        onToggleLogin: @escaping () -> Void
    ) {
        self.onOpen = onOpen
        self.onCheckForUpdates = onCheckForUpdates
        self.autoUpdateState = autoUpdateState
        self.onToggleAutoUpdate = onToggleAutoUpdate
        self.onToggleLogin = onToggleLogin
        super.init()
        item.button?.image = icon
        item.button?.imageScaling = .scaleProportionallyDown
        item.button?.toolTip = "ScreenFry"
        let menu = NSMenu()
        menu.delegate = self
        menu.autoenablesItems = false
        // The version, greyed out, at the very top.
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? ""
        let versionItem = NSMenuItem(title: "ScreenFry v\(version)", action: nil, keyEquivalent: "")
        versionItem.isEnabled = false
        menu.addItem(versionItem)
        menu.addItem(entry("What’s New…", #selector(whatsNew)))
        // Shown once Sparkle has found a newer version.
        updateItem = entry("Update ScreenFry…", #selector(check))
        updateItem.isHidden = true
        menu.addItem(updateItem)
        menu.addItem(.separator())
        menu.addItem(entry("Open ScreenFry", #selector(open)))
        menu.addItem(.separator())
        // The Mac App Store copy is updated by the App Store.
        if Flavor.current != .appStore { menu.addItem(entry("Check for Updates…", #selector(check))) }
        autoUpdate = entry("Install Updates Automatically", #selector(toggleAutoUpdate))
        menu.addItem(autoUpdate)
        login = entry("Start at Login", #selector(toggleLogin))
        menu.addItem(login)
        menu.addItem(.separator())
        let quit = NSMenuItem(title: "Quit ScreenFry", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        menu.addItem(quit)
        item.menu = menu
    }

    private func entry(_ title: String, _ action: Selector) -> NSMenuItem {
        let menuItem = NSMenuItem(title: title, action: action, keyEquivalent: "")
        menuItem.target = self
        return menuItem
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        let auto = autoUpdateState()
        autoUpdate.isHidden = auto == nil
        autoUpdate.state = auto == true ? .on : .off
        login.state = LoginItem.isEnabled ? .on : .off
    }

    /// A newer version is ready (or none is): the icon turns ScreenFry orange and the menu
    /// offers the update.
    func showUpdate(_ version: String?) {
        updateItem.isHidden = version == nil
        updateItem.title = version.map { "Update to ScreenFry \($0)…" } ?? "Update ScreenFry…"
        item.button?.image = version == nil ? icon : Self.tinted(icon, NSColor(srgbRed: 0.957, green: 0.384, blue: 0.122, alpha: 1))
        item.button?.toolTip = version.map { "ScreenFry \($0) is ready to install" } ?? "ScreenFry"
    }

    private static func tinted(_ image: NSImage?, _ color: NSColor) -> NSImage? {
        guard let image else { return nil }
        let copy = NSImage(size: image.size, flipped: false) { rect in
            image.draw(in: rect)
            color.set()
            rect.fill(using: .sourceAtop)
            return true
        }
        copy.isTemplate = false
        return copy
    }

    /// Uninstalling removes the icon before the app goes.
    func remove() { NSStatusBar.system.removeStatusItem(item) }

    /// This version's changes, on its GitHub release page.
    @objc private func whatsNew() {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? ""
        let page = version.isEmpty ? "" : "tag/v\(version)"
        if let url = URL(string: "https://github.com/yasserjaghoori/ScreenFry/releases/\(page)") {
            NSWorkspace.shared.open(url)
        }
    }

    @objc private func open() { onOpen() }
    @objc private func check() { onCheckForUpdates() }
    @objc private func toggleAutoUpdate() { onToggleAutoUpdate() }
    @objc private func toggleLogin() { onToggleLogin() }
}

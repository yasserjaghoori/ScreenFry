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
        let image = NSImage(systemSymbolName: "flame.fill", accessibilityDescription: "ScreenFry")
        image?.isTemplate = true
        item.button?.image = image
        item.button?.toolTip = "ScreenFry"
        let menu = NSMenu()
        menu.delegate = self
        menu.autoenablesItems = false
        menu.addItem(entry("Open ScreenFry", #selector(open)))
        menu.addItem(.separator())
        menu.addItem(entry("Check for Updates…", #selector(check)))
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

    /// Uninstalling removes the icon before the app goes.
    func remove() { NSStatusBar.system.removeStatusItem(item) }

    @objc private func open() { onOpen() }
    @objc private func check() { onCheckForUpdates() }
    @objc private func toggleAutoUpdate() { onToggleAutoUpdate() }
    @objc private func toggleLogin() { onToggleLogin() }
}

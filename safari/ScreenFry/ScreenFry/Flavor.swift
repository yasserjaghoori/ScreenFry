import Foundation

/// Which ScreenFry this is, fixed when it's built (`ScreenFryChannel` in Info.plist, set by
/// scripts/build-flavor.sh). The installer offers both, side by side:
///   - official: "ScreenFry", the full-color icon. Chrome gets ScreenFry from the Chrome Web
///     Store, which updates it. A ScreenFry folder already loaded unpacked (from before there
///     were two flavors) keeps getting updates until it's removed from Chrome.
///   - developer: "ScreenFry Developer", the greyed icon. Chrome loads the unpacked extension
///     from the folder this app keeps current (Developer mode), updated the moment the app is.
///   - appStore: the official ScreenFry from the Mac App Store ("ScreenFry App Store" target,
///     docs/MAC_APP_STORE.md): sandboxed, updated by the App Store (no Sparkle), no folder.
/// All share one bundle identifier, so there is only ever one ScreenFry in Safari; the two
/// downloads each update from their own feed (`SUFeedURL`).
enum Flavor: String {
    case official, developer
    case appStore = "appstore"

    static let current = Flavor(rawValue: Bundle.main.object(forInfoDictionaryKey: "ScreenFryChannel") as? String ?? "") ?? .official

    var name: String { self == .developer ? "ScreenFry Developer" : "ScreenFry" }
    /// The download to switch to (the Mac App Store copy has no switch).
    var other: Flavor { self == .developer ? .official : .developer }
    /// The bundled Dock and setup-window icon (see scripts/generate-icons.mjs).
    var brandIconName: String { self == .developer ? "BrandIconDeveloper" : "BrandIcon" }
    /// Chrome's ScreenFry comes from the Chrome Web Store (not the Developer mode folder).
    var usesChromeWebStore: Bool { self != .developer }

    /// ScreenFry's Chrome Web Store page.
    static let chromeWebStoreURL = URL(string: "https://chromewebstore.google.com/detail/\(ChromeNativeHost.storeExtensionID)")!
    /// The latest download, which holds both flavors.
    static let downloadURL = URL(string: "https://github.com/yasserjaghoori/ScreenFry/releases/latest")!
}

/// The user's real home folder. Inside the App Sandbox (Mac App Store), `NSHomeDirectory()`
/// and `homeDirectoryForCurrentUser` point into the app's container instead.
enum Home {
    static var real: URL {
        if let dir = getpwuid(getuid())?.pointee.pw_dir {
            return URL(fileURLWithPath: String(cString: dir), isDirectory: true)
        }
        return FileManager.default.homeDirectoryForCurrentUser
    }
}

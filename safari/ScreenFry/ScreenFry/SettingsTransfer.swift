import CryptoKit
import Foundation

/// Each browser's connection to the app (check-ins), Reset All Data and Erase Everything,
/// through `SettingsBridge` files. Adding a browser here gives it every one of these.
enum SettingsBrowser: String, CaseIterable {
    case safari, chrome

    var name: String { self == .safari ? "Safari" : "Chrome" }
    var bundleID: String { self == .safari ? "com.apple.Safari" : "com.google.Chrome" }

    var bridge: SettingsBridge {
        switch self {
        case .chrome:
            return SettingsBridge.local("Chrome")
        case .safari:
            // The Safari extension is sandboxed, so its handler writes inside its container.
            let id = (Bundle.main.bundleIdentifier ?? "com.screenfry.ScreenFry") + ".Extension"
            return SettingsBridge(directory: FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent("Library/Containers/\(id)/Data/Library/Application Support/ScreenFry/Bridge/Safari", isDirectory: true))
        }
    }
}

enum SettingsTransfer {

    /// The browser's last check-in: proof ScreenFry runs there, its version, and whether a
    /// settings password is on.
    static func checkIn(_ browser: SettingsBrowser) -> (at: Date, version: String, passwordProtected: Bool)? {
        guard let record = SettingsBridge.read(browser.bridge.checkInURL),
              let at = (record["at"] as? String).flatMap({ ISO8601DateFormatter().date(from: $0) })
        else { return nil }
        return (at, record["version"] as? String ?? "", record["passwordProtected"] as? Bool ?? false)
    }

    /// ScreenFry's extension id in the browser, as it last reported it (Chrome checks in with
    /// it from 0.7.3).
    static func extensionId(_ browser: SettingsBrowser) -> String? {
        let id = SettingsBridge.read(browser.bridge.checkInURL)?["extensionId"] as? String
        return id?.isEmpty == false ? id : nil
    }

    /// Asks the browser's copy of ScreenFry to restore its defaults at its next check-in.
    static func queueReset(_ browser: SettingsBrowser) throws {
        let bridge = browser.bridge
        try FileManager.default.createDirectory(at: bridge.directory, withIntermediateDirectories: true)
        try? FileManager.default.removeItem(at: bridge.resetResultURL)
        let request: [String: Any] = ["id": UUID().uuidString, "requestedAt": ISO8601DateFormatter().string(from: Date())]
        guard SettingsBridge.write(request, to: bridge.resetURL) else { throw CocoaError(.fileWriteUnknown) }
    }

    static func pendingReset(_ browser: SettingsBrowser) -> Bool {
        FileManager.default.fileExists(atPath: browser.bridge.resetURL.path)
    }

    static func lastResetResult(_ browser: SettingsBrowser) -> (ok: Bool, error: String?, at: Date?)? {
        guard let result = SettingsBridge.read(browser.bridge.resetResultURL) else { return nil }
        let at = (result["at"] as? String).flatMap { ISO8601DateFormatter().date(from: $0) }
        return (result["ok"] as? Bool ?? false, result["error"] as? String, at)
    }

    /// The browser's live setup as a share code, from its last check-in.
    static func setupCode(_ browser: SettingsBrowser) -> String? {
        let code = SettingsBridge.read(browser.bridge.checkInURL)?["setupCode"] as? String
        return code?.isEmpty == false ? code : nil
    }

    /// Sends a loadout to the browser's copy of ScreenFry, applied at its next check-in.
    static func queueSetup(_ browser: SettingsBrowser, code: String, name: String) throws {
        let bridge = browser.bridge
        try FileManager.default.createDirectory(at: bridge.directory, withIntermediateDirectories: true)
        try? FileManager.default.removeItem(at: bridge.setupResultURL)
        let request: [String: Any] = [
            "id": UUID().uuidString, "code": code, "name": name,
            "requestedAt": ISO8601DateFormatter().string(from: Date()),
        ]
        guard SettingsBridge.write(request, to: bridge.setupURL) else { throw CocoaError(.fileWriteUnknown) }
    }

    static func pendingSetup(_ browser: SettingsBrowser) -> String? {
        SettingsBridge.read(browser.bridge.setupURL)?["name"] as? String
    }

    static func lastSetupResult(_ browser: SettingsBrowser) -> (ok: Bool, waiting: Bool, error: String?, at: Date?)? {
        guard let result = SettingsBridge.read(browser.bridge.setupResultURL) else { return nil }
        let at = (result["at"] as? String).flatMap { ISO8601DateFormatter().date(from: $0) }
        return (result["ok"] as? Bool ?? false, result["waiting"] as? Bool ?? false, result["error"] as? String, at)
    }

    /// Asks the browser's copy of ScreenFry to erase everything it keeps (and, in Chrome, to
    /// remove itself) at its next check-in.
    static func requestErase(_ browser: SettingsBrowser) {
        let bridge = browser.bridge
        try? FileManager.default.createDirectory(at: bridge.directory, withIntermediateDirectories: true)
        try? FileManager.default.removeItem(at: bridge.eraseSentURL)
        SettingsBridge.write(["requestedAt": ISO8601DateFormatter().string(from: Date())], to: bridge.eraseURL)
    }

    static func eraseSent(_ browser: SettingsBrowser) -> Bool {
        FileManager.default.fileExists(atPath: browser.bridge.eraseSentURL.path)
    }
}

/// Chrome reaches the app through native messaging: it launches this binary with the
/// extension's origin as an argument, sends one length-prefixed JSON message on stdin and
/// reads one reply from stdout.
enum ChromeNativeHost {
    static let name = "com.screenfry.host"

    static func isLaunchedByChrome(_ arguments: [String]) -> Bool {
        arguments.dropFirst().contains { $0.hasPrefix("chrome-extension://") }
    }

    static func run() {
        // Chrome can close the pipe at any moment (for instance when ScreenFry reloads during
        // a check-in). Writing to a closed pipe must end this helper quietly: no SIGPIPE, and
        // the throwing FileHandle calls, since the older ones raise an exception that crashes
        // the process and shows a crash report.
        signal(SIGPIPE, SIG_IGN)
        let input = FileHandle.standardInput
        func read(_ count: Int) -> Data? {
            var data = Data()
            while data.count < count {
                guard let chunk = try? input.read(upToCount: count - data.count), !chunk.isEmpty else { return nil }
                data.append(chunk)
            }
            return data
        }
        guard let header = read(4) else { return }
        let length = header.withUnsafeBytes { Int(UInt32(littleEndian: $0.loadUnaligned(as: UInt32.self))) }
        guard length > 0, length < 8 * 1024 * 1024, let body = read(length),
              let message = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any]
        else { return }
        let reply = SettingsBrowser.chrome.bridge.handle(message)
        guard let out = try? JSONSerialization.data(withJSONObject: reply) else { return }
        var size = UInt32(out.count).littleEndian
        var framed = Data(bytes: &size, count: 4)
        framed.append(out)
        try? FileHandle.standardOutput.write(contentsOf: framed)
    }

    /// Chrome's native messaging manifest for the current user.
    static var manifestURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/Google/Chrome/NativeMessagingHosts/\(name).json")
    }

    /// Chrome names an unpacked extension after its folder path: the first 128 bits of the
    /// path's SHA-256, written with the letters a–p. ScreenFry's folder never moves.
    static func unpackedExtensionID(path: String) -> String {
        let letters = Array("abcdefghijklmnop")
        return SHA256.hash(data: Data(path.utf8)).prefix(16)
            .map { "\(letters[Int($0 >> 4)])\(letters[Int($0 & 0xF)])" }
            .joined()
    }

    /// ScreenFry's Chrome Web Store extension (an Unlisted item for now). Its ID is fixed by
    /// the store, so it's the same on every Mac.
    static let storeExtensionID = "epoooaclakcopjgkplhmbffbgcjhmdfe"

    /// The extensions allowed to talk to this app: the ScreenFry folder's unpacked copy and
    /// the Chrome Web Store copy (nothing else).
    static var allowedOrigins: [String] {
        [unpackedExtensionID(path: ChromeInstaller.folder.path), storeExtensionID]
            .map { "chrome-extension://\($0)/" }
    }

    /// Lets ScreenFry's own Chrome extensions talk to this app.
    static func register() throws {
        guard let executable = Bundle.main.executablePath else { return }
        let manifest: [String: Any] = [
            "name": name,
            "description": "ScreenFry check-ins, reset and erase",
            "path": executable,
            "type": "stdio",
            "allowed_origins": allowedOrigins,
        ]
        try FileManager.default.createDirectory(at: manifestURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        if let existing = SettingsBridge.read(manifestURL),
           NSDictionary(dictionary: existing).isEqual(to: manifest) { return }
        guard SettingsBridge.write(manifest, to: manifestURL) else { throw CocoaError(.fileWriteUnknown) }
    }
}

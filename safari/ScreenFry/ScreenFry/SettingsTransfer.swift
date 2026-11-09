import CryptoKit
import Foundation

/// ScreenFry Presets (website settings) export and import, reset and removal for each
/// browser, through `SettingsBridge` files. Adding a browser here gives it every one of these.
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
    static let settingsFormat = "screenfry-settings-v1"
    static let bundleFormat = "screenfry-settings-bundle-v1"
    private static let settingsKeys = ["format", "exportedAt", "rules", "windows", "earnGoals", "feedSettings", "warningsEnabled"]

    /// The browser's last check-in: proof ScreenFry runs there, its version, and whether a
    /// settings password is on.
    static func checkIn(_ browser: SettingsBrowser) -> (at: Date, version: String, passwordProtected: Bool)? {
        guard let record = SettingsBridge.read(browser.bridge.checkInURL),
              let at = (record["at"] as? String).flatMap({ ISO8601DateFormatter().date(from: $0) })
        else { return nil }
        return (at, record["version"] as? String ?? "", record["passwordProtected"] as? Bool ?? false)
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

    /// Settings the browser last sent, and when.
    static func snapshot(_ browser: SettingsBrowser) -> (settings: [String: Any], receivedAt: Date)? {
        let url = browser.bridge.snapshotURL
        guard let settings = SettingsBridge.read(url) else { return nil }
        let date = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? Date()
        return (settings, date)
    }

    static func pendingImport(_ browser: SettingsBrowser) -> Bool {
        FileManager.default.fileExists(atPath: browser.bridge.pendingURL.path)
    }

    static func lastResult(_ browser: SettingsBrowser) -> (ok: Bool, error: String?, at: Date?)? {
        guard let result = SettingsBridge.read(browser.bridge.resultURL) else { return nil }
        let at = (result["at"] as? String).flatMap { ISO8601DateFormatter().date(from: $0) }
        return (result["ok"] as? Bool ?? false, result["error"] as? String, at)
    }

    /// One browser's file, or every browser's settings in one bundle.
    static func exportData(_ browsers: [SettingsBrowser]) -> Data? {
        let object: [String: Any]
        if browsers.count == 1 {
            guard let settings = snapshot(browsers[0])?.settings else { return nil }
            object = settings
        } else {
            var all: [String: Any] = [:]
            for browser in browsers { all[browser.rawValue] = snapshot(browser)?.settings }
            guard !all.isEmpty else { return nil }
            object = ["format": bundleFormat, "exportedAt": ISO8601DateFormatter().string(from: Date()), "browsers": all]
        }
        return try? JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys])
    }

    enum ImportError: LocalizedError {
        case notSettings
        var errorDescription: String? { "This isn’t a ScreenFry Presets file. Choose a file exported from ScreenFry." }
    }

    /// Reads a settings file or bundle. A bundle maps browsers to their own settings; a plain
    /// settings file applies to whichever browser it's imported into.
    static func parse(_ data: Data) throws -> (single: [String: Any]?, byBrowser: [SettingsBrowser: [String: Any]]) {
        guard let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { throw ImportError.notSettings }
        func settings(_ value: Any?) -> [String: Any]? {
            guard let value = value as? [String: Any],
                  let format = value["format"] as? String,
                  format == settingsFormat || format == "screenfry-export-v3",
                  value["rules"] is [Any], value["windows"] is [Any]
            else { return nil }
            // A full extension export also carries usage history; only settings move.
            return value.filter { settingsKeys.contains($0.key) }
        }
        if object["format"] as? String == bundleFormat, let browsers = object["browsers"] as? [String: Any] {
            var byBrowser: [SettingsBrowser: [String: Any]] = [:]
            for (key, value) in browsers {
                if let browser = SettingsBrowser(rawValue: key), let s = settings(value) { byBrowser[browser] = s }
            }
            guard !byBrowser.isEmpty else { throw ImportError.notSettings }
            return (nil, byBrowser)
        }
        guard let single = settings(object) else { throw ImportError.notSettings }
        return (single, [:])
    }

    /// The settings to give `browser` from a parsed file: its own section, else the file's.
    static func settings(for browser: SettingsBrowser, in parsed: (single: [String: Any]?, byBrowser: [SettingsBrowser: [String: Any]])) -> [String: Any]? {
        parsed.byBrowser[browser] ?? parsed.single ?? parsed.byBrowser.values.first
    }

    /// Queues an import; the extension applies it the next time it checks in (about a minute).
    static func queueImport(_ settings: [String: Any], into browser: SettingsBrowser) throws {
        let bridge = browser.bridge
        try FileManager.default.createDirectory(at: bridge.directory, withIntermediateDirectories: true)
        try? FileManager.default.removeItem(at: bridge.resultURL)
        let pending: [String: Any] = [
            "id": UUID().uuidString,
            "requestedAt": ISO8601DateFormatter().string(from: Date()),
            "settings": settings,
        ]
        guard SettingsBridge.write(pending, to: bridge.pendingURL) else {
            throw CocoaError(.fileWriteUnknown)
        }
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
        let input = FileHandle.standardInput
        func read(_ count: Int) -> Data? {
            var data = Data()
            while data.count < count {
                let chunk = input.readData(ofLength: count - data.count)
                if chunk.isEmpty { return nil }
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
        let output = FileHandle.standardOutput
        output.write(Data(bytes: &size, count: 4))
        output.write(out)
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

    /// Lets the ScreenFry folder's extension (and nothing else) talk to this app.
    static func register() throws {
        guard let executable = Bundle.main.executablePath else { return }
        let manifest: [String: Any] = [
            "name": name,
            "description": "ScreenFry settings export and import",
            "path": executable,
            "type": "stdio",
            "allowed_origins": ["chrome-extension://\(unpackedExtensionID(path: ChromeInstaller.folder.path))/"],
        ]
        try FileManager.default.createDirectory(at: manifestURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        if let existing = SettingsBridge.read(manifestURL),
           NSDictionary(dictionary: existing).isEqual(to: manifest) { return }
        guard SettingsBridge.write(manifest, to: manifestURL) else { throw CocoaError(.fileWriteUnknown) }
    }
}

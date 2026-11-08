import Foundation

/// File handoff between the ScreenFry Mac app and one browser's copy of the extension.
/// Browser storage is out of the app's reach, so the extension sends its website settings
/// (never usage or the settings password) through native messaging, and this writes them to
/// `settings.json`. An import chosen in the app waits in `pending-import.json` until the
/// extension picks it up, then the extension's answer lands in `import-result.json`.
///
/// Safari: the sandboxed extension handler uses its own container. Chrome: the app binary,
/// launched by Chrome as a native messaging host, uses Application Support/ScreenFry.
struct SettingsBridge {
    static let snapshotName = "settings.json"
    static let pendingName = "pending-import.json"
    static let resultName = "import-result.json"

    let directory: URL
    var snapshotURL: URL { directory.appendingPathComponent(Self.snapshotName) }
    var pendingURL: URL { directory.appendingPathComponent(Self.pendingName) }
    var resultURL: URL { directory.appendingPathComponent(Self.resultName) }

    /// `<Application Support>/ScreenFry/Bridge/<name>` for the running process (inside a
    /// sandbox this resolves within the container).
    static func local(_ name: String) -> SettingsBridge {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return SettingsBridge(directory: support
            .appendingPathComponent("ScreenFry", isDirectory: true)
            .appendingPathComponent("Bridge", isDirectory: true)
            .appendingPathComponent(name, isDirectory: true))
    }

    /// Answers one `screenfry-sync` message from the extension.
    func handle(_ message: [String: Any]) -> [String: Any] {
        guard message["type"] as? String == "screenfry-sync" else {
            return ["ok": false, "error": "Unknown message"]
        }
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        if let result = message["importResult"] as? [String: Any], let id = result["id"] as? String {
            var record = result
            record["at"] = ISO8601DateFormatter().string(from: Date())
            Self.write(record, to: resultURL)
            if Self.read(pendingURL)?["id"] as? String == id {
                try? FileManager.default.removeItem(at: pendingURL)
            }
        }
        if let settings = message["settings"] as? [String: Any] {
            Self.write(settings, to: snapshotURL)
        }
        var reply: [String: Any] = ["ok": true]
        if let pending = Self.read(pendingURL), pending["id"] is String {
            reply["import"] = pending
        }
        return reply
    }

    static func read(_ url: URL) -> [String: Any]? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    @discardableResult
    static func write(_ object: [String: Any], to url: URL) -> Bool {
        guard JSONSerialization.isValidJSONObject(object),
              let data = try? JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys])
        else { return false }
        return (try? data.write(to: url, options: .atomic)) != nil
    }
}

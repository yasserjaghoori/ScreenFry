import Foundation

/// File handoff between the ScreenFry Mac app and one browser's copy of the extension.
/// Browser storage is out of the app's reach, so the extension checks in through native
/// messaging about once a minute: it reports its version and whether a settings password is
/// on (`check-in.json`) and sends its website settings (never usage or the password,
/// `settings.json`). Requests chosen in the app wait in files until the next check-in:
///   - `pending-import.json`  → the extension applies the settings, answers in `import-result.json`
///   - `pending-reset.json`   → the extension restores its defaults, answers in `reset-result.json`
///   - `pending-uninstall.json` → Chrome removes the extension; `uninstall-sent.json` records
///     that the request was handed over.
///
/// Safari: the sandboxed extension handler uses its own container. Chrome: the app binary,
/// launched by Chrome as a native messaging host, uses Application Support/ScreenFry.
struct SettingsBridge {
    static let snapshotName = "settings.json"
    static let checkInName = "check-in.json"
    static let pendingName = "pending-import.json"
    static let resultName = "import-result.json"
    static let resetName = "pending-reset.json"
    static let resetResultName = "reset-result.json"
    static let uninstallName = "pending-uninstall.json"
    static let uninstallSentName = "uninstall-sent.json"

    let directory: URL
    var snapshotURL: URL { directory.appendingPathComponent(Self.snapshotName) }
    var checkInURL: URL { directory.appendingPathComponent(Self.checkInName) }
    var pendingURL: URL { directory.appendingPathComponent(Self.pendingName) }
    var resultURL: URL { directory.appendingPathComponent(Self.resultName) }
    var resetURL: URL { directory.appendingPathComponent(Self.resetName) }
    var resetResultURL: URL { directory.appendingPathComponent(Self.resetResultName) }
    var uninstallURL: URL { directory.appendingPathComponent(Self.uninstallName) }
    var uninstallSentURL: URL { directory.appendingPathComponent(Self.uninstallSentName) }

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
        let fm = FileManager.default
        try? fm.createDirectory(at: directory, withIntermediateDirectories: true)
        let now = ISO8601DateFormatter().string(from: Date())
        Self.write([
            "at": now,
            "version": message["version"] as? String ?? "",
            "passwordProtected": message["passwordProtected"] as? Bool ?? false,
        ], to: checkInURL)
        for (key, pending, result) in [("importResult", pendingURL, resultURL), ("resetResult", resetURL, resetResultURL)] {
            guard let outcome = message[key] as? [String: Any], let id = outcome["id"] as? String else { continue }
            var record = outcome
            record["at"] = now
            Self.write(record, to: result)
            if Self.read(pending)?["id"] as? String == id {
                try? fm.removeItem(at: pending)
            }
        }
        if let settings = message["settings"] as? [String: Any] {
            Self.write(settings, to: snapshotURL)
        }
        var reply: [String: Any] = ["ok": true]
        if fm.fileExists(atPath: uninstallURL.path) {
            reply["uninstall"] = true
            Self.write(["at": now], to: uninstallSentURL)
            try? fm.removeItem(at: uninstallURL)
        } else if let reset = Self.read(resetURL), reset["id"] is String {
            reply["reset"] = reset
        } else if let pending = Self.read(pendingURL), pending["id"] is String {
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

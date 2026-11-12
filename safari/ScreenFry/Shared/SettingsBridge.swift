import Foundation

/// File handoff between the ScreenFry Mac app and one browser's copy of the extension.
/// Browser storage is out of the app's reach, so the extension checks in through native
/// messaging about once a minute: it reports only its version and whether a settings password
/// is on (`check-in.json`), never its settings or usage. Requests chosen in the app wait in
/// files until the next check-in:
///   - `pending-reset.json`   → the extension restores its defaults, answers in `reset-result.json`
///   - `pending-setup.json`  → a loadout from the app's own loadouts, as a share code: the
///     extension applies it as its live setup (or, with a password on, asks for it there),
///     and answers in `setup-result.json`. Each check-in also carries the browser's current
///     setup as a share code (`setupCode`), so the app can save it as one of its loadouts.
///   - `pending-erase.json` → Erase Everything: the extension wipes its storage (Safari keeps an
///     extension's storage after the app is deleted) and Chrome's also removes itself. It stays
///     until the app is gone, so every copy that checks in gets it (Chrome can run both the
///     unpacked and the Web Store copy); `erase-sent.json` lists the copies it was handed to.
///   - `copies.json` records when each copy (by extension id) last checked in, so the app knows
///     which copies to wait for.
///
/// Safari: the sandboxed extension handler uses its own container. Chrome: the app binary,
/// launched by Chrome as a native messaging host, uses Application Support/ScreenFry.
struct SettingsBridge {
    static let checkInName = "check-in.json"
    /// Files from 0.6.x settings export/import, deleted when a browser checks in.
    static let retiredNames = ["settings.json", "pending-import.json", "import-result.json"]
    static let resetName = "pending-reset.json"
    static let resetResultName = "reset-result.json"
    static let setupName = "pending-setup.json"
    static let setupResultName = "setup-result.json"
    static let eraseName = "pending-erase.json"
    static let eraseSentName = "erase-sent.json"
    static let copiesName = "copies.json"

    let directory: URL
    var checkInURL: URL { directory.appendingPathComponent(Self.checkInName) }
    var resetURL: URL { directory.appendingPathComponent(Self.resetName) }
    var resetResultURL: URL { directory.appendingPathComponent(Self.resetResultName) }
    var setupURL: URL { directory.appendingPathComponent(Self.setupName) }
    var setupResultURL: URL { directory.appendingPathComponent(Self.setupResultName) }
    var eraseURL: URL { directory.appendingPathComponent(Self.eraseName) }
    var eraseSentURL: URL { directory.appendingPathComponent(Self.eraseSentName) }
    var copiesURL: URL { directory.appendingPathComponent(Self.copiesName) }

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
        let extensionId = message["extensionId"] as? String ?? ""
        if !extensionId.isEmpty {
            var copies = Self.read(copiesURL) as? [String: String] ?? [:]
            copies[extensionId] = now
            Self.write(copies, to: copiesURL)
        }
        Self.write([
            "at": now,
            "version": message["version"] as? String ?? "",
            "passwordProtected": message["passwordProtected"] as? Bool ?? false,
            // Lets the app open ScreenFry's own pages in that browser.
            "extensionId": extensionId,
            // The version ScreenFry's running code was built as (0.7.6 on); missing means the
            // browser still runs code from before 0.7.3 whatever its manifest says.
            "codeVersion": message["codeVersion"] as? String ?? "",
            // The browser's live setup as a share code (no usage, history or password).
            "setupCode": message["setupCode"] as? String ?? "",
        ], to: checkInURL)
        for name in Self.retiredNames {
            try? fm.removeItem(at: directory.appendingPathComponent(name))
        }
        if let outcome = message["resetResult"] as? [String: Any], let id = outcome["id"] as? String {
            var record = outcome
            record["at"] = now
            Self.write(record, to: resetResultURL)
            if Self.read(resetURL)?["id"] as? String == id {
                try? fm.removeItem(at: resetURL)
            }
        }
        if let outcome = message["setupResult"] as? [String: Any], let id = outcome["id"] as? String {
            var record = outcome
            record["at"] = now
            Self.write(record, to: setupResultURL)
            if Self.read(setupURL)?["id"] as? String == id {
                try? fm.removeItem(at: setupURL)
            }
        }
        var reply: [String: Any] = ["ok": true]
        if fm.fileExists(atPath: eraseURL.path) {
            reply["erase"] = true
            reply["uninstall"] = true // what 0.6.4–0.6.5 Chrome extensions understand
            // Kept for the other copies; the app deletes the bridge when it's done.
            var sentTo = Self.read(eraseSentURL)?["extensionIds"] as? [String] ?? []
            if !extensionId.isEmpty, !sentTo.contains(extensionId) { sentTo.append(extensionId) }
            Self.write(["at": now, "extensionIds": sentTo], to: eraseSentURL)
        } else if let reset = Self.read(resetURL), reset["id"] is String {
            reply["reset"] = reset
        } else if let setup = Self.read(setupURL), setup["id"] is String, setup["code"] is String {
            reply["setup"] = setup
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

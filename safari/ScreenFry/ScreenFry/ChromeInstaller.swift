import Foundation

/// Keeps ScreenFry's Chrome extension in a fixed folder that Chrome loads as an unpacked
/// extension. The path never changes, so Chrome keeps the same extension (and its settings)
/// across app updates; the extension reloads itself when it sees a new build on disk.
enum ChromeInstaller {
    /// ~/Library/Application Support/ScreenFry/Chrome Extension
    static var folder: URL {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return support
            .appendingPathComponent("ScreenFry", isDirectory: true)
            .appendingPathComponent("Chrome Extension", isDirectory: true)
    }

    /// The Chrome build shipped inside ScreenFry.app.
    static var bundled: URL? {
        Bundle.main.url(forResource: "ChromeExtension", withExtension: nil)
    }

    static func version(at folder: URL) -> String? {
        guard
            let data = try? Data(contentsOf: folder.appendingPathComponent("manifest.json")),
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        return json["version"] as? String
    }

    static var installedVersion: String? { version(at: folder) }

    /// The build's fingerprint from build.json, so a rebuild with the same version still
    /// counts as new. Falls back to the version for builds made before build.json existed.
    static func buildID(at folder: URL) -> String? {
        if let data = try? Data(contentsOf: folder.appendingPathComponent("build.json")),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let build = json["build"] as? String {
            return build
        }
        return version(at: folder)
    }

    /// Copies the bundled build into place when it is missing or a different build.
    /// Returns true when files were written.
    @discardableResult
    static func sync() throws -> Bool {
        guard let source = bundled, let wanted = buildID(at: source) else { return false }
        if buildID(at: folder) == wanted { return false }
        let fm = FileManager.default
        let parent = folder.deletingLastPathComponent()
        try fm.createDirectory(at: parent, withIntermediateDirectories: true)
        // Copy beside the live folder first, then swap, so Chrome never sees a half-copied build.
        let staging = parent.appendingPathComponent("Chrome Extension.updating", isDirectory: true)
        try? fm.removeItem(at: staging)
        try fm.copyItem(at: source, to: staging)
        if fm.fileExists(atPath: folder.path) {
            _ = try fm.replaceItemAt(folder, withItemAt: staging)
        } else {
            try fm.moveItem(at: staging, to: folder)
        }
        return true
    }
}

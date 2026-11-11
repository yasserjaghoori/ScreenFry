import AppKit

/// The app's own loadouts: five setups kept on this Mac, each a ScreenFry share code
/// (websites, limits, windows, earn goals and feed controls; never usage or passwords).
/// A loadout can be saved from a browser's current setup (each browser sends it when it
/// checks in), pasted from a friend's code, copied, and sent to every connected browser.
enum AppLoadouts {
    static let count = 5
    private static let key = "appLoadouts"

    struct Loadout {
        var name: String
        var code: String
        var savedAt: Date
    }

    static func all() -> [Loadout?] {
        let saved = UserDefaults.standard.array(forKey: key) as? [[String: Any]] ?? []
        return (0..<count).map { i in
            guard i < saved.count, let code = saved[i]["code"] as? String, !code.isEmpty else { return nil }
            return Loadout(
                name: saved[i]["name"] as? String ?? "Loadout \(i + 1)",
                code: code,
                savedAt: saved[i]["savedAt"] as? Date ?? Date())
        }
    }

    static func set(_ index: Int, _ loadout: Loadout?) {
        var list = all()
        list[index] = loadout
        UserDefaults.standard.set(
            list.map { l -> [String: Any] in
                guard let l else { return [:] }
                return ["name": l.name, "code": l.code, "savedAt": l.savedAt]
            },
            forKey: key)
    }

    /// Reset All Data empties every loadout.
    static func clear() { UserDefaults.standard.removeObject(forKey: key) }

    /// Share codes start with "SF2-" (or the older "SCREENFRY-1-"); the browsers check the rest.
    static func looksLikeCode(_ text: String) -> Bool {
        text.hasPrefix("SF2-") || text.hasPrefix("SCREENFRY-1-")
    }
}

/// The "Loadouts for every browser" card in the main window.
final class AppLoadoutsPanel: NSObject {
    private let browsers: [SettingsBrowser]
    private weak var window: NSWindow?
    private let picker = NSSegmentedControl()
    private let title = NSTextField(labelWithString: "")
    private let detail = NSTextField(wrappingLabelWithString: "")
    private let status = NSTextField(wrappingLabelWithString: "")
    private var saveButtons: [SettingsBrowser: NSButton] = [:]
    private var copyButton: NSButton!
    private var sendButton: NSButton!
    private var emptyButton: NSButton!
    private var selected = 0

    init(browsers: [SettingsBrowser], window: NSWindow) {
        self.browsers = browsers
        self.window = window
        super.init()
    }

    func makeRows(button: (String, Selector, Bool) -> NSButton, helper: (String) -> NSTextField) -> [NSView] {
        picker.segmentCount = AppLoadouts.count
        for i in 0..<AppLoadouts.count { picker.setLabel("\(i + 1)", forSegment: i) }
        picker.trackingMode = .selectOne
        picker.selectedSegment = 0
        picker.target = self
        picker.action = #selector(pick(_:))
        title.font = .systemFont(ofSize: 13, weight: .semibold)
        detail.font = .systemFont(ofSize: 12)
        detail.textColor = .secondaryLabelColor
        status.font = .systemFont(ofSize: 11)
        status.textColor = .secondaryLabelColor

        let saves = browsers.map { browser -> NSButton in
            let b = button("Save \(browser.name)’s Setup", #selector(saveFromBrowser(_:)), false)
            b.tag = browsers.firstIndex(of: browser)!
            b.toolTip = "Keep \(browser.name)’s current setup in this loadout."
            saveButtons[browser] = b
            return b
        }
        let paste = button("Paste a Code…", #selector(paste(_:)), false)
        copyButton = button("Copy Code", #selector(copy(_:)), false)
        emptyButton = button("Empty", #selector(empty(_:)), false)
        sendButton = button("Use in All Browsers", #selector(send(_:)), true)
        let row1 = NSStackView(views: saves + [paste])
        row1.spacing = 8
        let row2 = NSStackView(views: [sendButton, copyButton, emptyButton])
        row2.spacing = 8
        refresh()
        return [
            helper("Keep up to five setups on this Mac and send one to every browser at once. A loadout is a share code: websites, limits, windows, earn goals and feed controls, never usage or passwords."),
            picker, title, detail, row1, row2, status,
        ]
    }

    func refresh() {
        let loadout = AppLoadouts.all()[selected]
        for i in 0..<AppLoadouts.count {
            picker.setToolTip(AppLoadouts.all()[i]?.name ?? "Empty", forSegment: i)
        }
        title.stringValue = loadout.map { "Loadout \(selected + 1): \($0.name)" } ?? "Loadout \(selected + 1) is empty"
        let date = DateFormatter.localizedString(from: loadout?.savedAt ?? Date(), dateStyle: .medium, timeStyle: .short)
        detail.stringValue = loadout == nil
            ? "Save a browser’s setup here, or paste a share code."
            : "Saved \(date). \(loadout!.code.count) characters as a share code."
        for (browser, b) in saveButtons {
            b.isEnabled = SettingsTransfer.setupCode(browser) != nil
            if !b.isEnabled { b.toolTip = "ScreenFry in \(browser.name) hasn’t checked in with its setup yet." }
        }
        copyButton.isEnabled = loadout != nil
        sendButton.isEnabled = loadout != nil && browsers.contains { SettingsTransfer.checkIn($0) != nil }
        emptyButton.isEnabled = loadout != nil
        var lines: [String] = []
        for browser in browsers {
            if let name = SettingsTransfer.pendingSetup(browser) {
                lines.append("Sending “\(name)” to \(browser.name): it applies the next time ScreenFry there checks in.")
            } else if let r = SettingsTransfer.lastSetupResult(browser), let at = r.at, Date().timeIntervalSince(at) < 3600 {
                lines.append(r.ok
                    ? "\(browser.name) is using the loadout you sent."
                    : r.waiting
                        ? "\(browser.name) has a settings password: open ScreenFry there and choose Use it."
                        : "\(browser.name) couldn’t use it: \(r.error ?? "unknown error").")
            }
        }
        status.stringValue = lines.joined(separator: "\n")
        status.isHidden = lines.isEmpty
    }

    @objc private func pick(_ sender: NSSegmentedControl) {
        selected = sender.selectedSegment
        refresh()
    }

    @objc private func saveFromBrowser(_ sender: NSButton) {
        let browser = browsers[sender.tag]
        guard let code = SettingsTransfer.setupCode(browser) else { return }
        if AppLoadouts.all()[selected] != nil, !confirm("Replace loadout \(selected + 1)?", "It will hold \(browser.name)’s current setup instead.") { return }
        AppLoadouts.set(selected, .init(name: "\(browser.name)’s setup", code: code, savedAt: Date()))
        refresh()
    }

    @objc private func paste(_ sender: Any?) {
        let alert = NSAlert()
        alert.messageText = "Paste a share code into loadout \(selected + 1)"
        alert.informativeText = "Codes start with SF2-. Give it a name you’ll recognize."
        let name = NSTextField(string: AppLoadouts.all()[selected]?.name ?? "")
        name.placeholderString = "Name, like Exam week"
        let code = NSTextField(string: NSPasteboard.general.string(forType: .string) ?? "")
        code.placeholderString = "SF2-…"
        let fields = NSStackView(views: [name, code])
        fields.orientation = .vertical
        fields.spacing = 8
        fields.frame = NSRect(x: 0, y: 0, width: 320, height: 56)
        name.widthAnchor.constraint(equalToConstant: 320).isActive = true
        code.widthAnchor.constraint(equalToConstant: 320).isActive = true
        alert.accessoryView = fields
        alert.addButton(withTitle: "Save")
        alert.addButton(withTitle: "Cancel")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        let text = code.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard AppLoadouts.looksLikeCode(text) else {
            return inform("That isn’t a ScreenFry share code", "Copy the whole code, starting with SF2-, and try again.")
        }
        let title = name.stringValue.trimmingCharacters(in: .whitespaces)
        AppLoadouts.set(selected, .init(name: title.isEmpty ? "Loadout \(selected + 1)" : String(title.prefix(40)), code: text, savedAt: Date()))
        refresh()
    }

    @objc private func copy(_ sender: Any?) {
        guard let loadout = AppLoadouts.all()[selected] else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(loadout.code, forType: .string)
        status.isHidden = false
        status.stringValue = "Copied “\(loadout.name)”’s share code."
    }

    @objc private func empty(_ sender: Any?) {
        guard confirm("Empty loadout \(selected + 1)?", "Its saved setup is removed from this Mac. Browsers keep whatever they’re using.") else { return }
        AppLoadouts.set(selected, nil)
        refresh()
    }

    @objc private func send(_ sender: Any?) {
        guard let loadout = AppLoadouts.all()[selected] else { return }
        let connected = browsers.filter { SettingsTransfer.checkIn($0) != nil }
        let names = connected.map(\.name).joined(separator: " and ")
        guard confirm(
            "Use “\(loadout.name)” in \(names)?",
            "Each browser’s websites, limits, windows, earn goals and feed controls are replaced with this loadout the next time ScreenFry there checks in, within about a minute. Today’s usage and settings passwords stay. A browser with a password asks for it there first."
        ) else { return }
        var failed: [String] = []
        for browser in connected {
            do { try SettingsTransfer.queueSetup(browser, code: loadout.code, name: loadout.name) } catch { failed.append(browser.name) }
        }
        if !failed.isEmpty { inform("Couldn’t send it", "ScreenFry couldn’t write the request for \(failed.joined(separator: " and ")).") }
        refresh()
    }

    private func confirm(_ question: String, _ text: String) -> Bool {
        let alert = NSAlert()
        alert.messageText = question
        alert.informativeText = text
        alert.addButton(withTitle: "Continue")
        alert.addButton(withTitle: "Cancel")
        return alert.runModal() == .alertFirstButtonReturn
    }

    private func inform(_ title: String, _ text: String) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = text
        alert.runModal()
    }
}

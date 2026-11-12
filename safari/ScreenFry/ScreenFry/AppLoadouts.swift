import AppKit

/// The app's own loadouts: five setups kept on this Mac. A loadout holds each browser's setup
/// as a ScreenFry share code (websites, limits, windows, earn goals and feed controls; never
/// usage or passwords), saved together with Save ScreenFry Setup from what each browser
/// sends when it checks in, or one pasted code used for every browser. "Use in All
/// Browsers" gives each browser its own setup.
enum AppLoadouts {
    static let count = 5
    private static let key = "appLoadouts"

    /// Key for a code used by every browser (a pasted single code).
    static let everyBrowser = "*"

    struct Loadout {
        var name: String
        /// Browser (its raw value, e.g. "safari") or `everyBrowser` → share code.
        var codes: [String: String]
        var savedAt: Date

        /// The code a browser gets: its own, else the one for every browser.
        func code(for browser: SettingsBrowser) -> String? {
            codes[browser.rawValue] ?? codes[AppLoadouts.everyBrowser]
        }

        /// One line to copy: the single code when every browser has the same setup, else a
        /// ScreenFry Mac code ("SFM1-") holding each browser's.
        var shareText: String {
            let distinct = Set(codes.values)
            if distinct.count == 1, let only = distinct.first { return only }
            let data = (try? JSONSerialization.data(withJSONObject: codes, options: [.sortedKeys])) ?? Data()
            return "SFM1-" + data.base64EncodedString()
                .replacingOccurrences(of: "+", with: "-")
                .replacingOccurrences(of: "/", with: "_")
                .replacingOccurrences(of: "=", with: "")
        }
    }

    static func all() -> [Loadout?] {
        let saved = UserDefaults.standard.array(forKey: key) as? [[String: Any]] ?? []
        return (0..<count).map { i in
            guard i < saved.count else { return nil }
            var codes = saved[i]["codes"] as? [String: String] ?? [:]
            // 0.7.4 kept one code per loadout.
            if let code = saved[i]["code"] as? String, !code.isEmpty { codes[everyBrowser] = code }
            guard !codes.isEmpty else { return nil }
            return Loadout(
                name: saved[i]["name"] as? String ?? "Loadout \(i + 1)",
                codes: codes,
                savedAt: saved[i]["savedAt"] as? Date ?? Date())
        }
    }

    static func set(_ index: Int, _ loadout: Loadout?) {
        var list = all()
        list[index] = loadout
        UserDefaults.standard.set(
            list.map { l -> [String: Any] in
                guard let l else { return [:] }
                return ["name": l.name, "codes": l.codes, "savedAt": l.savedAt]
            },
            forKey: key)
    }

    /// Reset All Data empties every loadout.
    static func clear() { UserDefaults.standard.removeObject(forKey: key) }

    /// A pasted code as codes by browser: a browser share code ("SF2-", or the older
    /// "SCREENFRY-1-") is for every browser; a Mac code ("SFM1-") has one per browser. The
    /// browsers check the codes themselves.
    static func codes(from text: String) -> [String: String]? {
        if text.hasPrefix("SF2-") || text.hasPrefix("SCREENFRY-1-") { return [everyBrowser: text] }
        guard text.hasPrefix("SFM1-") else { return nil }
        var b64 = String(text.dropFirst(5)).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while b64.count % 4 != 0 { b64 += "=" }
        guard let data = Data(base64Encoded: b64),
              let codes = (try? JSONSerialization.jsonObject(with: data)) as? [String: String],
              !codes.isEmpty,
              codes.values.allSatisfy({ $0.hasPrefix("SF2-") || $0.hasPrefix("SCREENFRY-1-") })
        else { return nil }
        return codes
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
    private var saveButton: NSButton!
    private var copyButton: NSButton!
    private var sendButton: NSButton!
    private var emptyButton: NSButton!
    private var renameButton: NSButton!
    private var selected = 0

    init(browsers: [SettingsBrowser], window: NSWindow) {
        self.browsers = browsers
        self.window = window
        super.init()
    }

    func makeRows(button make: (String, Selector, Bool) -> NSButton, helper: (String) -> NSTextField) -> [NSView] {
        // The window's button style, but the actions live here, not on the app delegate.
        func button(_ title: String, _ action: Selector, _ primary: Bool) -> NSButton {
            let b = make(title, action, primary)
            b.target = self
            return b
        }
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

        saveButton = button("Save ScreenFry Setup", #selector(saveSetup(_:)), false)
        let paste = button("Paste a Code…", #selector(paste(_:)), false)
        copyButton = button("Copy Code", #selector(copy(_:)), false)
        emptyButton = button("Empty", #selector(empty(_:)), false)
        renameButton = button("Rename…", #selector(rename(_:)), false)
        sendButton = button("Use in All Browsers", #selector(send(_:)), true)
        let row1 = NSStackView(views: [saveButton, paste])
        row1.spacing = 8
        let row2 = NSStackView(views: [sendButton, copyButton, renameButton, emptyButton])
        row2.spacing = 8
        refresh()
        return [
            helper("Keep up to five setups on this Mac. Save ScreenFry Setup keeps every browser’s current setup at once, and Use in All Browsers gives each browser its own back. A setup holds websites, limits, windows, earn goals and feed controls, never usage or passwords."),
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
        let holds = loadout.map { l in
            l.codes[AppLoadouts.everyBrowser] != nil
                ? "One setup for every browser."
                : "Setups for " + browsers.filter { l.codes[$0.rawValue] != nil }.map(\.name).joined(separator: " and ") + "."
        } ?? ""
        detail.stringValue = loadout == nil
            ? "Save ScreenFry’s setup here, or paste a share code."
            : "Saved \(date). \(holds)"
        let ready = browsers.filter { SettingsTransfer.setupCode($0) != nil }
        saveButton.isEnabled = !ready.isEmpty
        saveButton.toolTip = ready.isEmpty
            ? "No browser has sent its setup yet. Open a browser with ScreenFry on and wait a minute."
            : "Keep the current setup of " + ready.map(\.name).joined(separator: " and ") + " in this loadout."
        copyButton.isEnabled = loadout != nil
        sendButton.isEnabled = loadout != nil && browsers.contains { SettingsTransfer.checkIn($0) != nil }
        emptyButton.isEnabled = loadout != nil
        renameButton.isEnabled = loadout != nil
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
        // A browser that checks in without its setup can't be saved; usually it still runs an
        // older copy of ScreenFry until it's reloaded.
        for browser in browsers where SettingsTransfer.checkIn(browser) != nil && SettingsTransfer.setupCode(browser) == nil {
            lines.append("\(browser.name) hasn’t sent its setup yet. If this stays, reload ScreenFry on \(browser.name)’s Extensions page, or quit and reopen \(browser.name).")
        }
        status.stringValue = lines.joined(separator: "\n")
        status.isHidden = lines.isEmpty
    }

    @objc private func pick(_ sender: NSSegmentedControl) {
        selected = sender.selectedSegment
        refresh()
    }

    /// Saves every browser's current setup (what each sent at its last check-in) together.
    @objc private func saveSetup(_ sender: Any?) {
        var codes: [String: String] = [:]
        for browser in browsers { if let code = SettingsTransfer.setupCode(browser) { codes[browser.rawValue] = code } }
        guard !codes.isEmpty else { return }
        let names = browsers.filter { codes[$0.rawValue] != nil }.map(\.name).joined(separator: " and ")
        let missing = browsers.filter { codes[$0.rawValue] == nil }.map(\.name)
        var text = "It will hold the current setup of \(names)."
        if !missing.isEmpty { text += " \(missing.joined(separator: " and ")) hasn’t sent its setup yet, so it isn’t included." }
        if AppLoadouts.all()[selected] != nil, !confirm("Replace loadout \(selected + 1)?", text) { return }
        let date = DateFormatter.localizedString(from: Date(), dateStyle: .medium, timeStyle: .none)
        AppLoadouts.set(selected, .init(name: "ScreenFry setup, \(date)", codes: codes, savedAt: Date()))
        refresh()
    }

    @objc private func paste(_ sender: Any?) {
        let alert = NSAlert()
        alert.messageText = "Paste a share code into loadout \(selected + 1)"
        alert.informativeText = "A browser’s share code (SF2-…) is used for every browser; a code copied here (SFM1-…) keeps each browser’s own. Give it a name you’ll recognize."
        // Plain frames: an alert's accessory view doesn't size itself from constraints.
        let fields = NSView(frame: NSRect(x: 0, y: 0, width: 320, height: 58))
        let name = NSTextField(frame: NSRect(x: 0, y: 32, width: 320, height: 24))
        name.stringValue = AppLoadouts.all()[selected]?.name ?? ""
        name.placeholderString = "Name, like Exam week"
        let code = NSTextField(frame: NSRect(x: 0, y: 0, width: 320, height: 24))
        // Only offer the clipboard when it holds a code.
        let clipboard = NSPasteboard.general.string(forType: .string)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        code.stringValue = AppLoadouts.codes(from: clipboard) == nil ? "" : clipboard
        code.placeholderString = "Share code: SF2-… or SFM1-…"
        code.lineBreakMode = .byTruncatingTail
        fields.addSubview(name)
        fields.addSubview(code)
        alert.accessoryView = fields
        alert.window.initialFirstResponder = code.stringValue.isEmpty ? code : name
        alert.addButton(withTitle: "Save")
        alert.addButton(withTitle: "Cancel")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        let text = code.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let codes = AppLoadouts.codes(from: text) else {
            return inform("That isn’t a ScreenFry share code", "Copy the whole code, starting with SF2- or SFM1-, and try again.")
        }
        let title = name.stringValue.trimmingCharacters(in: .whitespaces)
        AppLoadouts.set(selected, .init(name: title.isEmpty ? "Loadout \(selected + 1)" : String(title.prefix(40)), codes: codes, savedAt: Date()))
        refresh()
    }

    @objc private func copy(_ sender: Any?) {
        guard let loadout = AppLoadouts.all()[selected] else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(loadout.shareText, forType: .string)
        status.isHidden = false
        status.stringValue = "Copied “\(loadout.name)”’s share code."
    }

    @objc private func rename(_ sender: Any?) {
        guard var loadout = AppLoadouts.all()[selected] else { return }
        let alert = NSAlert()
        alert.messageText = "Rename loadout \(selected + 1)"
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 260, height: 24))
        field.stringValue = loadout.name
        field.placeholderString = "Name, like Exam week"
        alert.accessoryView = field
        alert.window.initialFirstResponder = field
        alert.addButton(withTitle: "Save")
        alert.addButton(withTitle: "Cancel")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        let name = field.stringValue.trimmingCharacters(in: .whitespaces)
        loadout.name = name.isEmpty ? "Loadout \(selected + 1)" : String(name.prefix(40))
        AppLoadouts.set(selected, loadout)
        refresh()
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
        var skipped: [String] = []
        for browser in connected {
            // Each browser gets its own saved setup (or the one for every browser).
            guard let code = loadout.code(for: browser) else { skipped.append(browser.name); continue }
            do { try SettingsTransfer.queueSetup(browser, code: code, name: loadout.name) } catch { failed.append(browser.name) }
        }
        if !failed.isEmpty { inform("Couldn’t send it", "ScreenFry couldn’t write the request for \(failed.joined(separator: " and ")).") }
        if !skipped.isEmpty { inform("Not sent to \(skipped.joined(separator: " and "))", "This loadout has no setup saved for \(skipped.joined(separator: " and ")). Save ScreenFry Setup again once it has checked in.") }
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

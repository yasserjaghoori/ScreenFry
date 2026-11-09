import AppKit

/// Getting ScreenFry from the download into Applications, and tidying up after it.
///
/// The installer window is Finder showing the disk image, so it can't change once ScreenFry
/// is copied. ScreenFry does the rest itself: opened from the installer it offers to move
/// itself into Applications, and opened from Applications it ejects the installer (closing
/// that window) and says it's installed.
enum InstallFlow {
    static let applicationsCopy = URL(fileURLWithPath: "/Applications/ScreenFry.app")

    /// Running from the installer disk, or from the temporary copy macOS makes of a download
    /// ("App Translocation") until it has been moved.
    static var runningFromDownload: Bool {
        let path = Bundle.main.bundlePath
        return path.hasPrefix("/Volumes/") || path.contains("/AppTranslocation/")
    }

    /// Where this app really is when macOS runs it from a translocated copy.
    static func originalURL(of url: URL) -> URL {
        guard url.path.contains("/AppTranslocation/"),
              let handle = dlopen("/System/Library/Frameworks/Security.framework/Security", RTLD_LAZY),
              let symbol = dlsym(handle, "SecTranslocateCreateOriginalPathForURL")
        else { return url }
        typealias Original = @convention(c) (CFURL, UnsafeMutablePointer<Unmanaged<CFError>?>?) -> Unmanaged<CFURL>?
        let original = unsafeBitCast(symbol, to: Original.self)
        return (original(url as CFURL, nil)?.takeRetainedValue() as URL?) ?? url
    }

    /// Copies this app into Applications (an older copy goes to the Trash), lets macOS run
    /// it there, opens it and quits this copy. The new copy then ejects the installer.
    static func moveToApplications() throws {
        let fm = FileManager.default
        let source = originalURL(of: Bundle.main.bundleURL)
        // Quit an older ScreenFry that's still running so its copy can be replaced.
        for app in NSRunningApplication.runningApplications(withBundleIdentifier: Bundle.main.bundleIdentifier ?? "")
        where app.processIdentifier != ProcessInfo.processInfo.processIdentifier {
            app.terminate()
        }
        let deadline = Date().addingTimeInterval(5)
        while Date() < deadline,
              NSRunningApplication.runningApplications(withBundleIdentifier: Bundle.main.bundleIdentifier ?? "")
                .contains(where: { $0.processIdentifier != ProcessInfo.processInfo.processIdentifier }) {
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        }
        if fm.fileExists(atPath: applicationsCopy.path) {
            try fm.trashItem(at: applicationsCopy, resultingItemURL: nil)
        }
        try fm.copyItem(at: source, to: applicationsCopy)
        // A copy made by an app (rather than dragged in Finder) keeps the download flag, and
        // macOS would run it from a temporary location again. This copy was already checked
        // by Gatekeeper (it's running), so clear the flag as Finder's move would.
        let xattr = Process()
        xattr.executableURL = URL(fileURLWithPath: "/usr/bin/xattr")
        xattr.arguments = ["-dr", "com.apple.quarantine", applicationsCopy.path]
        try? xattr.run()
        xattr.waitUntilExit()
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.createsNewApplicationInstance = true
        NSWorkspace.shared.openApplication(at: applicationsCopy, configuration: configuration) { _, _ in
            DispatchQueue.main.async { NSApp.terminate(nil) }
        }
    }

    /// Mounted ScreenFry installer disks, with the version of the app inside each.
    static func mountedInstallers() -> [(volume: URL, version: String?)] {
        let fm = FileManager.default
        return (fm.mountedVolumeURLs(includingResourceValuesForKeys: nil, options: [.skipHiddenVolumes]) ?? [])
            .filter { $0.path.hasPrefix("/Volumes/") }
            .compactMap { volume in
                let app = volume.appendingPathComponent("ScreenFry.app")
                guard fm.fileExists(atPath: app.path) else { return nil }
                return (volume, Bundle(url: app)?.infoDictionary?["CFBundleShortVersionString"] as? String)
            }
    }

    /// True when `a` is a later version than `b` ("0.6.10" > "0.6.9").
    static func isNewer(_ a: String, than b: String) -> Bool {
        a.compare(b, options: .numeric) == .orderedDescending
    }
}

/// A green "installed" banner that slides in at the top of the window.
final class InstalledBanner: NSView {
    init(title: String, detail: String) {
        super.init(frame: .zero)
        wantsLayer = true
        layer?.cornerRadius = 14
        layer?.backgroundColor = NSColor.systemGreen.withAlphaComponent(0.13).cgColor
        layer?.borderWidth = 1
        layer?.borderColor = NSColor.systemGreen.withAlphaComponent(0.35).cgColor
        translatesAutoresizingMaskIntoConstraints = false

        let check = NSImageView()
        check.image = NSImage(systemSymbolName: "checkmark.circle.fill", accessibilityDescription: nil)?
            .withSymbolConfiguration(.init(pointSize: 26, weight: .semibold).applying(.init(paletteColors: [.white, .systemGreen])))
        check.wantsLayer = true
        let heading = NSTextField(labelWithString: title)
        heading.font = .systemFont(ofSize: 14, weight: .semibold)
        let body = NSTextField(wrappingLabelWithString: detail)
        body.font = .systemFont(ofSize: 12)
        body.textColor = .secondaryLabelColor
        body.preferredMaxLayoutWidth = 480
        let text = NSStackView(views: [heading, body])
        text.orientation = .vertical
        text.alignment = .leading
        text.spacing = 2
        let row = NSStackView(views: [check, text])
        row.alignment = .centerY
        row.spacing = 12
        row.translatesAutoresizingMaskIntoConstraints = false
        addSubview(row)
        NSLayoutConstraint.activate([
            row.topAnchor.constraint(equalTo: topAnchor, constant: 12),
            row.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -12),
            row.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 14),
            row.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -14),
        ])
        setAccessibilityElement(true)
        setAccessibilityRole(.staticText)
        setAccessibilityLabel("\(title). \(detail)")
        self.check = check
    }

    required init?(coder: NSCoder) { nil }
    private weak var check: NSImageView?

    /// Fades and slides in, then the check mark pops.
    func play() {
        alphaValue = 0
        layer?.transform = CATransform3DMakeTranslation(0, 10, 0)
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.45
            context.timingFunction = CAMediaTimingFunction(name: .easeOut)
            animator().alphaValue = 1
        }
        let slide = CABasicAnimation(keyPath: "transform.translation.y")
        slide.fromValue = 10
        slide.toValue = 0
        slide.duration = 0.45
        slide.timingFunction = CAMediaTimingFunction(name: .easeOut)
        layer?.add(slide, forKey: "slide")
        layer?.transform = CATransform3DIdentity
        guard let checkLayer = check?.layer, !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion else { return }
        // Scale around the check mark's centre, not its corner.
        let frame = checkLayer.frame
        checkLayer.anchorPoint = CGPoint(x: 0.5, y: 0.5)
        checkLayer.position = CGPoint(x: frame.midX, y: frame.midY)
        let pop = CAKeyframeAnimation(keyPath: "transform.scale")
        pop.values = [0.4, 1.25, 0.92, 1.0]
        pop.keyTimes = [0, 0.5, 0.75, 1]
        pop.duration = 0.6
        pop.beginTime = CACurrentMediaTime() + 0.25
        pop.fillMode = .backwards
        checkLayer.add(pop, forKey: "pop")
    }
}

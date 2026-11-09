import Foundation
import SafariServices

/// Native endpoint for the Safari Web Extension. ScreenFry keeps its state in the extension's
/// own storage. Two native messages arrive here: `screenfry-sync`, which hands website
/// settings (and reset requests) to and from the Mac app (see Shared/SettingsBridge.swift),
/// and `screenfry-open-settings`, which opens Safari Settings → Extensions → ScreenFry.
final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        let item = context.inputItems.first as? NSExtensionItem
        let message = item?.userInfo?[SFExtensionMessageKey] as? [String: Any] ?? [:]
        if message["type"] as? String == "screenfry-open-settings" {
            let id = Bundle.main.bundleIdentifier ?? "com.screenfry.ScreenFry.Extension"
            SFSafariApplication.showPreferencesForExtension(withIdentifier: id) { error in
                var reply: [String: Any] = ["ok": error == nil]
                if let error { reply["error"] = error.localizedDescription }
                Self.complete(context, reply)
            }
            return
        }
        Self.complete(context, SettingsBridge.local("Safari").handle(message))
    }

    private static func complete(_ context: NSExtensionContext, _ reply: [String: Any]) {
        let response = NSExtensionItem()
        response.userInfo = [SFExtensionMessageKey: reply]
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }
}

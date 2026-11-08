import Foundation
import SafariServices

/// Native endpoint for the Safari Web Extension. ScreenFry keeps its state in the extension's
/// own storage; the only native message is `screenfry-sync`, which hands website settings to
/// and from the Mac app for export and import (see Shared/SettingsBridge.swift).
final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        let item = context.inputItems.first as? NSExtensionItem
        let message = item?.userInfo?[SFExtensionMessageKey] as? [String: Any] ?? [:]
        let response = NSExtensionItem()
        response.userInfo = [SFExtensionMessageKey: SettingsBridge.local("Safari").handle(message)]
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }
}

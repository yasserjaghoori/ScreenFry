import Foundation
import SafariServices

/// Native endpoint for the Safari Web Extension. ScreenFry keeps all state in the
/// WebExtension's own storage during Phase 1, so native messaging is unused and every
/// request receives an empty reply. Phase 2 (macOS app) can route messages through here.
final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        context.completeRequest(returningItems: [NSExtensionItem()], completionHandler: nil)
    }
}

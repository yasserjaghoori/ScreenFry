import SafariServices
import os.log

final class SafariWebExtensionHandler: SFSafariExtensionHandler {
    override func validateToolbarItem(in window: SFSafariWindow, validationHandler: @escaping (Bool, String) -> Void) {
        validationHandler(true, "")
    }
}

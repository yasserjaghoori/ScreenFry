# Manual testing

## Chrome and Incognito

1. Run `npm run build`; load `dist/chrome` as an unpacked extension.
2. Complete all onboarding steps and confirm a non-six-digit or mismatched PIN is rejected.
3. Add `youtube.com` with a one-minute limit and a live commitment. Keep a YouTube tab active in a focused window until it redirects.
4. Confirm video, Shorts, `m.youtube.com`, `youtu.be`, and embed URLs redirect, while Google Search does not.
5. Enter a wrong PIN three times and confirm the 30-second cooldown. Enter the correct PIN and confirm all YouTube tabs are usable for the same 10-minute window.
6. Restart Chrome during that window; confirm its original absolute expiry remains. After expiry, reload/open tabs and confirm blocking resumes.
7. Try increasing the committed allowance or removing the rule. Confirm the current rule remains and a pending change appears.
8. On `chrome://extensions`, open Screentime details and enable **Allow in Incognito**. In dashboard Settings, choose **Check access** and confirm “Sealproof-ready.” Disable it and confirm the status is no longer verified.
9. Open an Incognito window and repeat the direct-link test. Chrome may require closing existing Incognito windows after changing access.

## Safari Private Browsing

1. Build and sign the containing app in Xcode, enable the extension in Safari Settings → Extensions, and grant website access.
2. In Safari Settings → Extensions, enable the extension for Private Browsing where the installed Safari version exposes that option.
3. Open a Private window and visit a currently blocked direct URL. Confirm the blocked page appears.
4. Safari coverage must remain labeled **manual/unverified** because a reliable supported verification API is not available across supported Safari versions.

## Reliability scenarios

Test active versus background tabs, unfocused windows, 60+ seconds of idle state, sleep/wake, local midnight, an overnight schedule, a time-zone switch, and backward clock movement. Automated unit tests cover policy boundaries, commitments, URL matching, feed selector generation, verifier behavior, and override expiration. Browser event integration still requires these manual checks.

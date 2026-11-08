import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { send, setSettingsCredential } from "@browser/messages";
import { detectBrowser } from "@browser/platform";
import { STATE_KEY } from "@browser/storage";
import { extensionPageUrl } from "@browser/urls";
import { migrateState } from "@core/defaults";
import { launchSites } from "@core/sites";
import { siteFor } from "@feeds/index";
import type { AppState, FeedSite } from "@shared/index";
import { SiteControls } from "../ui/SiteControls";
import { SettingsGate } from "../ui/SettingsGate";
import { SitePicker } from "../ui/SitePicker";
import { siteStatus } from "../ui/siteStatus";
import "../styles/global.css";
import "../styles/dashboard.css";
import "../styles/popup.css";
function Popup() {
  const [state, setState] = useState<AppState>(),
    [site, setSite] = useState<FeedSite>(launchSites[0].id),
    [error, setError] = useState(""),
    [unlocked, setUnlocked] = useState(false),
    [siteAccess, setSiteAccess] = useState(true);
  useEffect(() => {
    // Draw immediately from saved settings. Safari has to wake its background page first,
    // and waiting for it made the popover open tiny and then jump to full size.
    void chrome.storage.local
      .get(STATE_KEY)
      .then((saved) =>
        setState((current) => current ?? migrateState(saved[STATE_KEY])),
      )
      .catch(() => undefined);
    void send<AppState>({ type: "GET_STATE" }).then((r) =>
      r.ok ? setState(r.data) : setError(r.error),
    );
    // Without access to every website, Safari shows its own permission prompt over the
    // popup and ScreenFry can't act on most pages, so say so plainly.
    void Promise.resolve(
      chrome.permissions?.contains({ origins: ["<all_urls>"] }),
    )
      .then((granted) => setSiteAccess(granted !== false))
      .catch(() => undefined);
    void chrome.tabs
      .query({ active: true, currentWindow: true })
      .then(([tab]) => {
        try {
          const found = siteFor(new URL(tab?.url ?? "").hostname);
          if (found) setSite(found.site);
        } catch {
          /* not a website */
        }
      });
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === "local" && changes[STATE_KEY]?.newValue)
        setState(migrateState(changes[STATE_KEY].newValue));
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);
  const open = (page: string) =>
    chrome.tabs.create({
      url: extensionPageUrl("dashboard.html", { site }, page),
    });
  return (
    <main className="popup">
      <header className="popup-head">
        <strong className="popup-title">
          <img src="icons/icon-64.png" alt="" />
          ScreenFry
        </strong>
        <button
          className="button ghost"
          onClick={() => void open("settings")}
          aria-label="Open settings"
        >
          Settings ↗
        </button>
      </header>
      {!siteAccess && (
        <div className="notice warn popup-access" role="status">
          <strong>ScreenFry needs access to every website.</strong>
          {detectBrowser() === "safari" ? (
            <span>
              In Safari, open Settings → Extensions → ScreenFry, then set{" "}
              <em>Edit Websites → Other Websites</em> to <em>Allow</em>.
            </span>
          ) : (
            <span>
              Right-click the ScreenFry icon →{" "}
              <em>This can read and change site data</em> →{" "}
              <em>On all sites</em>.
            </span>
          )}
        </div>
      )}
      <nav className="popup-nav" aria-label="Sections">
        <button className="selected" onClick={() => void open("websites")}>
          Websites ↗
        </button>
        <button onClick={() => void open("windows")}>Windows ↗</button>
      </nav>
      <SitePicker
        value={site}
        onChange={(next) => {
          setSite(next);
          setError("");
        }}
        status={state ? (id) => siteStatus(state, id).label : undefined}
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {state ? (
        <SettingsGate
          state={state}
          unlocked={unlocked}
          onUnlock={() => setUnlocked(true)}
        >
          <SiteControls
            key={site}
            state={state}
            site={site}
            onState={setState}
            onError={setError}
          />
        </SettingsGate>
      ) : (
        <p className="muted">Loading…</p>
      )}
      {state?.settingsPassword && unlocked && (
        <button
          className="button secondary block"
          onClick={() => {
            setSettingsCredential();
            setUnlocked(false);
          }}
        >
          Lock settings
        </button>
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Popup />);

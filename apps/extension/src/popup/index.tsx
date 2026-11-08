import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { setSettingsCredential } from "@browser/messages";
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
    // Opening controls must not wake a full background sweep through every tab.
    // Enforcement and usage checkpoints run independently; edits still go through send().
    let mounted = true;
    void chrome.storage.local
      .get(STATE_KEY)
      .then((saved) => {
        if (mounted)
          setState(
            (current) =>
              current ?? migrateState(saved[STATE_KEY], detectBrowser()),
          );
      })
      .catch(() => {
        if (mounted)
          setError("Saved controls couldn't load. Close and reopen ScreenFry.");
      });
    // Host access is not required to draw settings. Only read the current URL when
    // access is already granted; otherwise Safari may wait for a website permission.
    void (async () => {
      try {
        const granted = await chrome.permissions?.contains({
          origins: ["<all_urls>"],
        });
        if (!mounted) return;
        setSiteAccess(granted !== false);
        if (granted !== true) return;
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (!mounted) return;
        try {
          const found = siteFor(new URL(tab?.url ?? "").hostname);
          if (found) setSite(found.site);
        } catch {
          /* not a website */
        }
      } catch {
        /* Optional site detection must never prevent opening the controls. */
      }
    })();
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === "local" && changes[STATE_KEY]?.newValue)
        setState(migrateState(changes[STATE_KEY].newValue, detectBrowser()));
    };
    chrome.storage.onChanged.addListener(listener);
    return () => {
      mounted = false;
      chrome.storage.onChanged.removeListener(listener);
    };
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
          <strong>ScreenFry may not have access to some websites.</strong>
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

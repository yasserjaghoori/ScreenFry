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
const SAFARI_ACCESS_NOTICE_DISMISSED = "safariSiteAccessNoticeDismissed";
function Popup() {
  const [state, setState] = useState<AppState>(),
    [site, setSite] = useState<FeedSite>(launchSites[0].id),
    [error, setError] = useState(""),
    [unlocked, setUnlocked] = useState(false),
    [siteAccess, setSiteAccess] = useState(true),
    [accessNoticeDismissed, setAccessNoticeDismissed] = useState(false);
  const isSafari = detectBrowser() === "safari";
  useEffect(() => {
    // Opening controls must not wake a full background sweep through every tab.
    // Enforcement and usage checkpoints run independently; edits still go through send().
    let mounted = true;
    void chrome.storage.local
      .get([STATE_KEY, SAFARI_ACCESS_NOTICE_DISMISSED])
      .then((saved) => {
        if (mounted) {
          setAccessNoticeDismissed(
            saved[SAFARI_ACCESS_NOTICE_DISMISSED] === true,
          );
          setState(
            (current) =>
              current ?? migrateState(saved[STATE_KEY], detectBrowser()),
          );
        }
      })
      .catch(() => {
        if (mounted)
          setError("Saved controls couldn't load. Close and reopen ScreenFry.");
      });
    let activeTabId: number | undefined;
    let activeUrl: string | undefined;
    const updated = (id: number, change: chrome.tabs.OnUpdatedInfo) => {
      if (
        id === activeTabId &&
        (change.status === "loading" ||
          (change.url && change.url !== activeUrl))
      )
        window.close();
    };
    const activated = (info: chrome.tabs.OnActivatedInfo) => {
      if (activeTabId !== undefined && info.tabId !== activeTabId)
        window.close();
    };
    chrome.tabs.onUpdated.addListener(updated);
    chrome.tabs.onActivated.addListener(activated);
    // Safari can leave the popup floating after you switch to another app; close it then.
    // Focus moving inside the popup never blurs the window, so this only fires on leaving.
    let blurTimer: ReturnType<typeof setTimeout> | undefined;
    const left = () => {
      // A native menu (the daily-limit dropdown) can take focus from the popup while open.
      if (document.activeElement instanceof HTMLSelectElement) return;
      blurTimer = setTimeout(() => {
        if (!document.hasFocus()) window.close();
      }, 150);
    };
    const returned = () => clearTimeout(blurTimer);
    if (isSafari) {
      window.addEventListener("blur", left);
      window.addEventListener("focus", returned);
    }
    // The tabs permission allows URL metadata without requesting website access.
    // Safari's broad host-permission answer must not gate current-site selection.
    void chrome.permissions
      ?.contains({ origins: ["<all_urls>"] })
      .then((granted) => {
        if (mounted) setSiteAccess(granted !== false);
      })
      .catch(() => undefined);
    void (async () => {
      try {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (!mounted) return;
        activeTabId = tab?.id;
        activeUrl = tab?.url;
        try {
          let current = new URL(tab?.url ?? "");
          if (current.href.startsWith(chrome.runtime.getURL("blocked.html"))) {
            const original =
              current.searchParams.get("source") === "network"
                ? current.search.slice(current.search.indexOf("&url=") + 5)
                : current.searchParams.get("url");
            if (original) current = new URL(original);
          }
          const found = siteFor(current.hostname);
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
      chrome.tabs.onUpdated.removeListener(updated);
      chrome.tabs.onActivated.removeListener(activated);
      window.removeEventListener("blur", left);
      window.removeEventListener("focus", returned);
      clearTimeout(blurTimer);
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
      {!siteAccess && !(isSafari && accessNoticeDismissed) && (
        <div className="notice warn popup-access" role="status">
          <strong>
            {isSafari
              ? "Safari hasn’t confirmed access to all websites."
              : "ScreenFry may not have access to some websites."}
          </strong>
          {isSafari ? (
            <span>
              In Safari, open Settings → Extensions → ScreenFry, then set{" "}
              <em>Edit Websites → Other Websites</em> to <em>Allow</em>. If
              prompted, check <em>Remember for other websites</em> and choose{" "}
              <em>Always Allow</em>. Already done? You can dismiss this
              reminder; Safari may still report access as unconfirmed.
            </span>
          ) : (
            <span>
              Right-click the ScreenFry icon →{" "}
              <em>This can read and change site data</em> →{" "}
              <em>On all sites</em>.
            </span>
          )}
          {isSafari && (
            <button
              className="button popup-open-safari"
              onClick={async () => {
                const r = await send({ type: "OPEN_SAFARI_SETTINGS" });
                if (r.ok) window.close();
                else
                  setError(
                    "Safari didn’t open its settings. Open Safari → Settings → Extensions → ScreenFry.",
                  );
              }}
            >
              Open ScreenFry in Safari Settings
            </button>
          )}
          {isSafari && (
            <button
              className="button secondary"
              onClick={() => {
                setAccessNoticeDismissed(true);
                void chrome.storage.local
                  .set({ [SAFARI_ACCESS_NOTICE_DISMISSED]: true })
                  .catch(() => {
                    setError(
                      "The reminder is hidden for now, but its dismissal couldn’t be saved.",
                    );
                  });
              }}
            >
              Dismiss reminder
            </button>
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

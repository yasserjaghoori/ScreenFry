import React, { useState } from "react";
import type { ProtectionStatus } from "@shared/index";
import { formatDate } from "./format";

export function protectionLabel(protection: ProtectionStatus): {
  ready: boolean;
  title: string;
  detail: string;
} {
  if (protection.privateAccess === "verified") {
    return {
      ready: true,
      title: "Private browsing confirmed",
      detail: `Chrome confirmed Incognito access${protection.lastCheckedAt ? ` (${formatDate(protection.lastCheckedAt)})` : ""}.`,
    };
  }
  if (protection.privateAccess === "observed") {
    return {
      ready: true,
      title: "Private browsing confirmed",
      detail: `ScreenFry saw itself running in a Private window on ${formatDate(protection.lastObservedAt)}. Safari can’t report if this is later turned off, so re-check after changing extension settings.`,
    };
  }
  return {
    ready: false,
    title: "Private browsing not confirmed",
    detail:
      protection.browser === "safari"
        ? "Safari has no API that reports this setting. Follow the steps, open a Private window, then check again."
        : "Chrome reports that ScreenFry is not allowed in Incognito.",
  };
}

/** Browser-specific steps plus a check that never claims more than the browser can prove. */
export function PrivateAccessGuide({
  protection,
  onCheck,
}: {
  protection: ProtectionStatus;
  onCheck: () => Promise<void>;
}) {
  const [checking, setChecking] = useState(false);
  const status = protectionLabel(protection);
  const id = chrome.runtime.id;
  return (
    <div className="notice">
      {protection.browser === "chrome" ? (
        <ol className="guide">
          <li>
            Open <code>chrome://extensions/?id={id}</code> (Chrome doesn’t allow
            extensions to open it for you, so paste it into the address bar).
          </li>
          <li>
            Turn on <strong>Allow in Incognito</strong>.
          </li>
          <li>
            Come back here and choose <strong>Check again</strong>.
          </li>
        </ol>
      ) : (
        <ol className="guide">
          <li>
            Open <strong>Safari → Settings → Extensions</strong> and select
            ScreenFry.
          </li>
          <li>
            Turn on <strong>Allow in Private Browsing</strong>, and set website
            access to <strong>Allow</strong> for all websites.
          </li>
          <li>Open a new Private window (⇧⌘N) and leave it open.</li>
          <li>
            Come back here and choose <strong>Check again</strong>. ScreenFry
            confirms coverage only when it can see that Private window.
          </li>
        </ol>
      )}
      <div className="row spread wrap">
        <span className={`pill ${status.ready ? "" : "warn"}`}>
          {status.title}
        </span>
        <button
          className="button secondary"
          disabled={checking}
          onClick={async () => {
            setChecking(true);
            await onCheck();
            setChecking(false);
          }}
        >
          {checking ? "Checking…" : "Check again"}
        </button>
      </div>
      <p className="muted small">{status.detail}</p>
    </div>
  );
}

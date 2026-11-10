import React from "react";
import { detectBrowser } from "@browser/platform";

/** Version, how time is counted, and where ScreenFry keeps its data. */
export function About() {
  const browser = detectBrowser() === "safari" ? "Safari" : "Chrome";
  const other = browser === "Safari" ? "Chrome" : "Safari";
  return (
    <div className="settings-content">
      <section className="card settings-block about-block">
        <div className="about-head">
          <img src="icons/icon-128.png" alt="" />
          <div>
            <h2>ScreenFry</h2>
            <p className="muted">
              Version {chrome.runtime.getManifest().version} for {browser} ·
              Less feed. More day.
            </p>
          </div>
        </div>
        <p className="muted">
          ScreenFry hides distracting feeds and buttons, sets daily website
          limits, and lets you choose when websites are open.
        </p>
      </section>
      <section className="card settings-block">
        <h2>On this browser</h2>
        <p className="muted">
          Time counts on the focused tab and while audio or video plays in the
          background. An inactive, non-playing tab does not count. Each website
          is counted once, even with multiple tabs playing.
        </p>
        <p className="muted">
          Settings and usage stay in {browser}. {browser} and {other} have
          separate allowances. There are no accounts or analytics.
        </p>
      </section>
      <section className="card settings-block">
        <h2>More</h2>
        <p className="muted">
          ScreenFry is made by{" "}
          <a href="https://bhron.org" target="_blank" rel="noreferrer">
            Samir
          </a>{" "}
          and{" "}
          <a href="https://unjamlabs.com" target="_blank" rel="noreferrer">
            Yasser
          </a>
          .{" "}
          <a
            href="https://github.com/yasserjaghoori/ScreenFry"
            target="_blank"
            rel="noreferrer"
          >
            Source code and releases
          </a>
          .
        </p>
      </section>
    </div>
  );
}

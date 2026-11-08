import React, { useEffect, useRef, useState } from "react";
import { launchSites } from "@core/sites";
import type { FeedSite } from "@shared/index";

const Avatar = ({ id }: { id: FeedSite }) => {
  const site = launchSites.find((s) => s.id === id)!;
  return (
    <span
      className="site-avatar small-avatar"
      style={{ background: site.color }}
      aria-hidden="true"
    >
      {site.symbol}
    </span>
  );
};

/**
 * Website dropdown that keeps each site's logo visible. Scales to any number of sites in
 * the registry. Keyboard: arrows move, Enter/Space choose, Escape closes.
 */
export function SitePicker({
  value,
  onChange,
  status,
}: {
  value: FeedSite;
  onChange: (site: FeedSite) => void;
  /** Optional right-hand text for each site, e.g. "4m today". */
  status?: (site: FeedSite) => string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(value);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const current = launchSites.find((s) => s.id === value)!;

  useEffect(() => {
    if (!open) return;
    setActive(value);
    list.current?.focus();
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open, value]);

  const choose = (site: FeedSite) => {
    onChange(site);
    setOpen(false);
  };
  const move = (step: number) => {
    const i = launchSites.findIndex((s) => s.id === active);
    setActive(
      launchSites[(i + step + launchSites.length) % launchSites.length].id,
    );
  };

  return (
    <div className="site-select" ref={root}>
      <button
        type="button"
        className="site-select-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Website: ${current.name}`}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Avatar id={value} />
        <span className="site-select-name">{current.name}</span>
        {status && <span className="site-select-status">{status(value)}</span>}
        <svg
          className="site-select-chevron"
          viewBox="0 0 16 16"
          aria-hidden="true"
        >
          <path
            d="M4 6l4 4 4-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <ul
        id="site-picker"
        ref={list}
        className="site-select-menu"
        role="listbox"
        aria-label="Website"
        aria-activedescendant={`site-option-${active}`}
        tabIndex={-1}
        hidden={!open}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") move(1);
          else if (e.key === "ArrowUp") move(-1);
          else if (e.key === "Enter" || e.key === " ") choose(active);
          else if (e.key === "Escape") setOpen(false);
          else return;
          e.preventDefault();
        }}
      >
        {launchSites.map((s) => (
          <li
            key={s.id}
            id={`site-option-${s.id}`}
            role="option"
            aria-selected={s.id === value}
            className={`${s.id === value ? "selected" : ""} ${s.id === active ? "active" : ""}`}
            onMouseEnter={() => setActive(s.id)}
            onClick={() => choose(s.id)}
          >
            <Avatar id={s.id} />
            <span className="site-select-name">{s.name}</span>
            {status && (
              <span className="site-select-status">{status(s.id)}</span>
            )}
            {s.id === value && (
              <svg
                className="site-select-check"
                viewBox="0 0 16 16"
                aria-hidden="true"
              >
                <path
                  d="M3.5 8.5l3 3 6-7"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

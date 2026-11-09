import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * A time field that opens a picker: hour and minute steppers (type or use the arrows),
 * AM/PM, a 12/24-hour switch remembered per browser, and a few quick picks. The value is a
 * minute of the day (0–1439).
 */
type Format = "12" | "24";
const FORMAT_KEY = "screenfry.timeFormat";
const QUICK = [8 * 60, 12 * 60, 18 * 60, 21 * 60];
const MINUTE_STEP = 5;

function savedFormat(): Format {
  try {
    const saved = localStorage.getItem(FORMAT_KEY);
    if (saved === "12" || saved === "24") return saved;
  } catch {
    /* storage blocked: fall back to the locale */
  }
  const sample = new Date(2000, 0, 1, 13).toLocaleTimeString([], { hour: "numeric" });
  return /13/.test(sample) ? "24" : "12";
}
/** Forgets the 12/24-hour choice (Restore defaults). */
export function clearTimeFormatPreference() {
  try {
    localStorage.removeItem(FORMAT_KEY);
  } catch {
    /* storage blocked: nothing saved */
  }
}
const pad = (n: number) => String(n).padStart(2, "0");
const hour12 = (minute: number) => ((Math.floor(minute / 60) + 11) % 12) + 1;
const isPm = (minute: number) => minute >= 720;
export function formatTime(minute: number, format: Format): string {
  return format === "24"
    ? `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`
    : `${hour12(minute)}:${pad(minute % 60)} ${isPm(minute) ? "PM" : "AM"}`;
}
const wrap = (minute: number) => ((minute % 1440) + 1440) % 1440;

const Clock = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);
const Chevron = ({ up }: { up?: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={up ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} />
  </svg>
);

export function TimePicker({
  id,
  value,
  onChange,
}: {
  id: string;
  value: number;
  onChange: (minute: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<Format>(savedFormat);
  const [shift, setShift] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) =>
      !root.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
      field.current?.focus();
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", key, true);
    };
  }, [open]);
  // Slide the picker sideways as needed to keep it inside its dialog; the pointer stays on
  // the field.
  useLayoutEffect(() => {
    if (!open || !popover.current || !root.current) return;
    const bounds = (root.current.closest(".modal") ?? document.body).getBoundingClientRect();
    const start = root.current.getBoundingClientRect().left;
    const width = popover.current.offsetWidth;
    const overRight = start + width - (bounds.right - 12);
    setShift(-Math.max(0, Math.min(overRight, start - (bounds.left + 12))));
    popover.current.querySelector<HTMLInputElement>("input")?.focus();
  }, [open]);

  function chooseFormat(next: Format) {
    setFormat(next);
    try {
      localStorage.setItem(FORMAT_KEY, next);
    } catch {
      /* remembered for this page only */
    }
  }
  const hours = Math.floor(value / 60),
    minutes = value % 60;
  const stepHour = (by: number) => onChange(wrap(value + by * 60));
  const stepMinute = (by: number) => {
    const snapped =
      by > 0
        ? Math.floor(minutes / MINUTE_STEP) * MINUTE_STEP + MINUTE_STEP
        : Math.ceil(minutes / MINUTE_STEP) * MINUTE_STEP - MINUTE_STEP;
    onChange(hours * 60 + ((snapped + 60) % 60));
  };
  const typedHour = (n: number) => {
    if (format === "24") return n >= 0 && n <= 23 && onChange(n * 60 + minutes);
    if (n < 1 || n > 12) return;
    onChange(((n % 12) + (isPm(value) ? 12 : 0)) * 60 + minutes);
  };
  const typedMinute = (n: number) => n >= 0 && n <= 59 && onChange(hours * 60 + n);
  const setPm = (pm: boolean) =>
    pm !== isPm(value) && onChange(wrap(value + (pm ? 720 : -720)));

  return (
    <div className="time-picker" ref={root}>
      <button
        ref={field}
        id={id}
        type="button"
        className={`time-field ${open ? "is-open" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span>{formatTime(value, format)}</span>
        <Clock />
      </button>
      {open && (
        <div
          ref={popover}
          className="time-popover"
          style={{ "--shift": `${shift}px` } as React.CSSProperties}
          role="dialog"
          aria-label="Select time"
        >
          <div className="time-popover-head">
            <span className="time-popover-title">
              <Clock size={20} /> Select time
            </span>
            <div className="time-format" role="radiogroup" aria-label="Clock format">
              {(["12", "24"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  role="radio"
                  aria-checked={format === f}
                  className={format === f ? "selected" : ""}
                  onClick={() => chooseFormat(f)}
                >
                  {f}-hour
                </button>
              ))}
            </div>
          </div>
          <div className="time-dials">
            <Stepper
              label="Hour"
              value={format === "24" ? pad(hours) : String(hour12(value))}
              onStep={stepHour}
              onType={typedHour}
            />
            <span className="time-colon" aria-hidden="true">:</span>
            <Stepper label="Minute" value={pad(minutes)} onStep={stepMinute} onType={typedMinute} />
            {format === "12" && (
              <div className="time-meridiem" role="radiogroup" aria-label="AM or PM">
                {[false, true].map((pm) => (
                  <button
                    key={String(pm)}
                    type="button"
                    role="radio"
                    aria-checked={isPm(value) === pm}
                    className={isPm(value) === pm ? "selected" : ""}
                    onClick={() => setPm(pm)}
                  >
                    {pm ? "PM" : "AM"}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="time-quick">
            <span>Quick select</span>
            <div>
              {QUICK.map((minute) => (
                <button
                  key={minute}
                  type="button"
                  className={minute === value ? "selected" : ""}
                  onClick={() => {
                    onChange(minute);
                    setOpen(false);
                    field.current?.focus();
                  }}
                >
                  {formatTime(minute, format)}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Up arrow, a number you can type over, down arrow. Arrow keys step too. */
function Stepper({
  label,
  value,
  onStep,
  onType,
}: {
  label: string;
  value: string;
  onStep: (by: number) => void;
  onType: (n: number) => void;
}) {
  const [draft, setDraft] = useState<string>();
  const commit = () => {
    if (draft !== undefined && /^\d{1,2}$/.test(draft)) onType(Number(draft));
    setDraft(undefined);
  };
  return (
    <div className="time-stepper">
      <button type="button" tabIndex={-1} aria-label={`Increase ${label.toLowerCase()}`} onClick={() => onStep(1)}>
        <Chevron up />
      </button>
      <input
        aria-label={label}
        inputMode="numeric"
        maxLength={2}
        value={draft ?? value}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, ""))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            setDraft(undefined);
            onStep(e.key === "ArrowUp" ? 1 : -1);
          } else if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
      />
      <button type="button" tabIndex={-1} aria-label={`Decrease ${label.toLowerCase()}`} onClick={() => onStep(-1)}>
        <Chevron />
      </button>
    </div>
  );
}

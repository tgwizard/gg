import { type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PLAYER_COLORS } from "../../shared/colors";
import { MAX_NAME_LENGTH } from "../../shared/protocol";
import { Avatar, playerStyle } from "../../ui";
import { noAutofill } from "../noAutofill";
import { SettingsLink } from "./SettingsLink";

/**
 * The palette as a radio group. `taken` marks colors others in the room have: you can
 * still pick one, but you'll get the next free color until they change theirs.
 */
export function ColorPicker(props: { value: number; onChange(color: number): void; taken?: ReadonlyMap<number, string>; label?: string }) {
  const { value, onChange, taken, label = "Your color" } = props;
  return (
    <div className="swatches" role="radiogroup" aria-label={label}>
      {PLAYER_COLORS.map((c, i) => {
        const by = taken?.get(i);
        return (
          <button
            key={c.name}
            type="button"
            role="radio"
            aria-checked={value === i}
            aria-label={by ? `${c.name} (taken by ${by})` : c.name}
            title={by ? `${c.name}, taken by ${by}` : c.name}
            className={`swatch ${by ? "taken" : ""}`}
            style={playerStyle(i)}
            onClick={() => onChange(i)}
          />
        );
      })}
    </div>
  );
}

export function NameField(props: { value: string; onChange(v: string): void; onBlur?(): void; autoFocus?: boolean; label?: string }) {
  const { value, onChange, onBlur, autoFocus, label = "Your name" } = props;
  return (
    <label className="field">
      <span>{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder="e.g. Ada"
        maxLength={MAX_NAME_LENGTH}
        autoFocus={autoFocus}
        {...noAutofill}
      />
    </label>
  );
}

/** Name and color, with a preview; submits both. Also used for bots. */
export function ProfileForm(props: {
  name: string;
  color: number;
  submitLabel: string;
  onSubmit(name: string, color: number): void;
  onCancel?(): void;
  taken?: ReadonlyMap<number, string>;
  /** Whose profile it is, if not yours (e.g. "Bot"): labels the fields "Bot's name", "Bot's color". */
  whose?: string;
  bot?: boolean;
  /** A line under the name in the preview (default: the color's name). */
  caption?: string;
  /** More fields, between the color and the buttons. */
  children?: ReactNode;
}) {
  const nameLabel = props.whose ? `${props.whose}'s name` : "Your name";
  const colorLabel = props.whose ? `${props.whose}'s color` : "Your color";
  const [name, setName] = useState(props.name);
  const [color, setColor] = useState(props.color);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim()) props.onSubmit(name, color);
  }
  return (
    <form className="profile-form" onSubmit={submit} onKeyDown={(e) => e.key === "Escape" && props.onCancel?.()}>
      <div className="profile-preview">
        <Avatar name={name || "?"} color={color} bot={props.bot} size="lg" />
        <div className="profile-preview-text">
          <strong className="name" style={playerStyle(color)}>
            {name.trim() || nameLabel}
          </strong>
          <span className="muted small">{props.caption ?? PLAYER_COLORS[color]!.name}</span>
        </div>
      </div>
      <NameField value={name} onChange={setName} label={nameLabel} autoFocus />
      <div className="field">
        <span>{colorLabel}</span>
        <ColorPicker value={color} onChange={setColor} taken={props.taken} label={colorLabel} />
      </div>
      {props.children}
      <div className="row">
        <button className="btn primary" disabled={!name.trim()}>
          {props.submitLabel}
        </button>
        {props.onCancel && (
          <button type="button" className="btn ghost" onClick={props.onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

/** Your avatar and name in the top bar; opens the profile editor. */
export function ProfileMenu(props: { name: string; color: number; onSave(name: string, color: number): void; taken?: ReadonlyMap<number, string> }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <div className="profile-menu">
      <button ref={button} className="name-button" onClick={() => setOpen(!open)} aria-expanded={open} title="Edit your profile">
        <Avatar name={props.name} color={props.color} />
        <span className="name-button-text">{props.name}</span>
      </button>
      {open && button.current && (
        <Popover anchor={button.current} label="Your profile" onClose={() => setOpen(false)}>
          <ProfileForm
            name={props.name}
            color={props.color}
            submitLabel="Save"
            taken={props.taken}
            onSubmit={(name, color) => {
              props.onSave(name, color);
              setOpen(false);
            }}
            onCancel={() => setOpen(false)}
          >
            <p className="muted small profile-settings-link">
              <SettingsLink>All settings</SettingsLink>: AI keys, and the data gg keeps in this browser.
            </p>
          </ProfileForm>
        </Popover>
      )}
    </div>
  );
}

/**
 * A small dialog under `anchor`, right-aligned with it (or left-aligned, kept on
 * screen), moved up if it would run off the bottom of the window (and scrolling inside
 * if it's taller than the window). Clicking elsewhere closes it.
 */
export function Popover({
  anchor,
  label,
  onClose,
  align = "right",
  className = "",
  hover,
  children,
}: {
  anchor: HTMLElement;
  label: string;
  onClose(): void;
  align?: "left" | "right";
  className?: string;
  /** Hover handlers, for a popover that opens on hover (see `usePeek`). */
  hover?: PeekHover;
  children: ReactNode;
}) {
  const pop = useRef<HTMLDivElement>(null);
  const rect = anchor.getBoundingClientRect();
  const [top, setTop] = useState(rect.bottom + 10);
  const [left, setLeft] = useState(Math.max(12, rect.left));
  const below = rect.bottom + 10;
  useLayoutEffect(() => {
    const el = pop.current;
    if (!el) return;
    // Re-placed whenever its content grows or shrinks (e.g. a field appears).
    const place = () => {
      setTop(Math.max(12, Math.min(below, window.innerHeight - el.offsetHeight - 12)));
      setLeft(Math.max(12, Math.min(rect.left, window.innerWidth - el.offsetWidth - 12)));
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(el);
    return () => observer.disconnect();
  }, [below, rect.left]);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!pop.current?.contains(t) && !anchor.contains(t)) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [anchor, onClose]);
  return createPortal(
    <div
      ref={pop}
      className={`profile-pop box ${className}`}
      role="dialog"
      aria-label={label}
      style={align === "left" ? { top, left } : { top, right: Math.max(12, window.innerWidth - rect.right) }}
      {...hover}
    >
      {children}
    </div>,
    document.body,
  );
}

type PeekHover = { onPointerEnter(e: ReactPointerEvent): void; onPointerLeave(e: ReactPointerEvent): void };

/**
 * Details behind an icon: a look while the mouse is over it (or the popover), and
 * kept open by a click. Touch has no hover, so there it's just the click.
 */
export function usePeek() {
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const hover: PeekHover = {
    onPointerEnter(e) {
      if (e.pointerType !== "mouse") return;
      clearTimeout(timer.current);
      setHovered(true);
    },
    onPointerLeave(e) {
      if (e.pointerType !== "mouse") return;
      clearTimeout(timer.current);
      // Long enough to cross the gap between the icon and its popover.
      timer.current = setTimeout(() => setHovered(false), 250);
    },
  };
  const close = useCallback(() => {
    clearTimeout(timer.current);
    setPinned(false);
    setHovered(false);
  }, []);
  return {
    open: pinned || hovered,
    pinned,
    hover,
    toggle: () => (pinned ? close() : setPinned(true)),
    close,
  };
}

import { type FormEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PLAYER_COLORS } from "../../shared/colors";
import { MAX_NAME_LENGTH } from "../../shared/protocol";
import { Avatar, playerStyle } from "../../ui";
import { noAutofill } from "../noAutofill";

/**
 * The palette as a radio group. `taken` marks colors others in the room have: you can
 * still pick one, but you'll get the next free color until they change theirs.
 */
export function ColorPicker({ value, onChange, taken }: { value: number; onChange(color: number): void; taken?: ReadonlyMap<number, string> }) {
  return (
    <div className="swatches" role="radiogroup" aria-label="Your color">
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

export function NameField({ value, onChange, onBlur, autoFocus }: { value: string; onChange(v: string): void; onBlur?(): void; autoFocus?: boolean }) {
  return (
    <label className="field">
      <span>Your name</span>
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

/** Name and color, with a preview; submits both. */
export function ProfileForm(props: {
  name: string;
  color: number;
  submitLabel: string;
  onSubmit(name: string, color: number): void;
  onCancel?(): void;
  taken?: ReadonlyMap<number, string>;
}) {
  const [name, setName] = useState(props.name);
  const [color, setColor] = useState(props.color);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim()) props.onSubmit(name, color);
  }
  return (
    <form className="profile-form" onSubmit={submit} onKeyDown={(e) => e.key === "Escape" && props.onCancel?.()}>
      <div className="profile-preview">
        <Avatar name={name || "?"} color={color} size="lg" />
        <div className="profile-preview-text">
          <strong className="name" style={playerStyle(color)}>
            {name.trim() || "Your name"}
          </strong>
          <span className="muted small">{PLAYER_COLORS[color]!.name}</span>
        </div>
      </div>
      <NameField value={name} onChange={setName} autoFocus />
      <div className="field">
        <span>Your color</span>
        <ColorPicker value={color} onChange={setColor} taken={props.taken} />
      </div>
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
  const pop = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!pop.current?.contains(t) && !button.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  const rect = open ? button.current?.getBoundingClientRect() : undefined;
  return (
    <div className="profile-menu">
      <button ref={button} className="name-button" onClick={() => setOpen(!open)} aria-expanded={open} title="Edit your profile">
        <Avatar name={props.name} color={props.color} />
        {props.name}
      </button>
      {open &&
        rect &&
        createPortal(
        <div
          ref={pop}
          className="profile-pop box"
          role="dialog"
          aria-label="Your profile"
          style={{ top: rect.bottom + 10, right: Math.max(12, window.innerWidth - rect.right) }}
        >
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
          />
        </div>,
          document.body,
        )}
    </div>
  );
}

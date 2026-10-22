import { type FormEvent, useState } from "react";
import { MAX_NAME_LENGTH } from "../../shared/protocol";

export function NameForm(props: {
  initial: string;
  submitLabel: string;
  compact?: boolean;
  onSubmit(name: string): void;
  onCancel?(): void;
}) {
  const [value, setValue] = useState(props.initial);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (value.trim()) props.onSubmit(value);
  }
  return (
    <form onSubmit={submit} className={props.compact ? "row compact" : "stack"}>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && props.onCancel?.()}
        placeholder="Your name"
        aria-label="Your name"
        maxLength={MAX_NAME_LENGTH}
        autoFocus
      />
      <button className="btn primary" disabled={!value.trim()}>
        {props.submitLabel}
      </button>
    </form>
  );
}

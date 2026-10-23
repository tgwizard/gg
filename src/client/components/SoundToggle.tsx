import { setSoundOn, useSoundOn } from "../../ui";

/** A small speaker: sound effects on or off. */
export function SoundToggle() {
  const on = useSoundOn();
  return (
    <button
      type="button"
      className="mode-toggle"
      onClick={() => setSoundOn(!on)}
      aria-label={on ? "Turn sounds off" : "Turn sounds on"}
      aria-pressed={on}
      title={on ? "Sounds on" : "Sounds off"}
      data-testid="sound-toggle"
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
        {on ? <path d="M15.5 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" /> : <path d="M16 9.5l5 5M21 9.5l-5 5" />}
      </svg>
    </button>
  );
}

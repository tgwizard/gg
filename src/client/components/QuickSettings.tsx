import { useRef } from "react";
import { MODE_SHORTCUT, setSoundOn, toggleMode, useMode, useNarrow, useSoundOn } from "../../ui";
import { ModeIcon, ModeToggle } from "./ModeToggle";
import { Popover, usePeek } from "./Popover";
import { SoundIcon, SoundToggle } from "./SoundToggle";

/** Sound and light/dark: a button each, or on a phone (where the top bar is one row) one button for both. */
export function QuickSettings() {
  const narrow = useNarrow();
  const peek = usePeek();
  const button = useRef<HTMLButtonElement>(null);
  const sound = useSoundOn();
  const dark = useMode() === "dark";
  if (!narrow) {
    return (
      <>
        <SoundToggle />
        <ModeToggle />
      </>
    );
  }
  return (
    <>
      <button ref={button} type="button" className="mode-toggle" onClick={peek.toggle} aria-expanded={peek.open} aria-label="Sound and light or dark">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
          <circle cx="15" cy="7" r="2" />
          <circle cx="9" cy="17" r="2" />
        </svg>
      </button>
      {peek.open && button.current && (
        <Popover anchor={button.current} label="Sound and light or dark" onClose={peek.close} className="peek-pop quick-pop">
          <button type="button" className="quick-row" onClick={() => setSoundOn(!sound)} aria-pressed={sound} data-testid="sound-toggle">
            <SoundIcon on={sound} />
            <span>Sounds</span>
            <span className="quick-state">{sound ? "On" : "Off"}</span>
          </button>
          <button type="button" className="quick-row" onClick={toggleMode} aria-pressed={dark} title={MODE_SHORTCUT}>
            <ModeIcon sun={false} />
            <span>Dark mode</span>
            <span className="quick-state">{dark ? "On" : "Off"}</span>
          </button>
        </Popover>
      )}
    </>
  );
}

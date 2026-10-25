import { useRef } from "react";
import { MODE_SHORTCUT, setSoundOn, toggleMode, useMode, useNarrow, useSoundOn } from "../../ui";
import { ModeIcon } from "./ModeToggle";
import { Popover, usePeek } from "./Popover";
import { SettingsLink } from "./SettingsLink";
import { SoundIcon, SoundToggle } from "./SoundToggle";

/**
 * A cog by your profile: sound and light or dark at hand, and the way to all settings.
 * With `sound` (in a room, on a wide screen), the sound switch also sits beside it.
 */
export function SettingsMenu({ sound: withSound = false }: { sound?: boolean }) {
  const narrow = useNarrow();
  const peek = usePeek();
  const button = useRef<HTMLButtonElement>(null);
  const sound = useSoundOn();
  const dark = useMode() === "dark";
  return (
    <>
      {withSound && !narrow && <SoundToggle />}
      <button ref={button} type="button" className="mode-toggle" onClick={peek.toggle} aria-expanded={peek.open} aria-label="Settings" title="Settings" data-testid="settings-menu">
        <CogIcon />
      </button>
      {peek.open && button.current && (
        <Popover anchor={button.current} label="Settings" onClose={peek.close} className="peek-pop quick-pop">
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
          <p className="quick-more small">
            <SettingsLink>All settings</SettingsLink>: your profile, bots, AI keys and data.
          </p>
        </Popover>
      )}
    </>
  );
}

export function CogIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}

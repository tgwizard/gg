import { useState } from "react";
import { Button, busyWhy } from "../../../ui";
import type { GameSetupProps } from "../../ui";
import { TimerField } from "../../kit/ui/TimerField";
import type { BsConfig } from "../engine";
import "./battleship.css";

export function BattleshipSetup({ busy, connected, onStart }: GameSetupProps<BsConfig>) {
  const [config, setConfig] = useState<BsConfig>({ turnSeconds: 30, placeSeconds: 120, shipsMayTouch: true, hitShootsAgain: false });
  const seconds = (key: "turnSeconds" | "placeSeconds", label: string, hint: string) => (
    <TimerField label={label} value={config[key]} onChange={(s) => setConfig({ ...config, [key]: s })} hint={hint} />
  );
  const check = (key: "shipsMayTouch" | "hitShootsAgain", label: string, hint: string) => (
    <label className="bs-check">
      <input type="checkbox" checked={config[key]} onChange={(e) => setConfig({ ...config, [key]: e.target.checked })} />
      <span>
        {label} <span className="muted">{hint}</span>
      </span>
    </label>
  );
  return (
    <form
      className="bs-setup"
      onSubmit={(e) => {
        e.preventDefault();
        onStart(config);
      }}
    >
      <p className="muted">
        Two players hide five ships each on a 10×10 sea, then take turns firing blind. Sink the whole enemy fleet to win.
      </p>
      <div className="bs-setup-fields">
        {seconds("turnSeconds", "Turn timer", "run out and a shot is fired at random for you")}
        {seconds("placeSeconds", "Placement timer", "run out and the rest of your fleet is placed at random")}
      </div>
      {check("shipsMayTouch", "Ships may touch", "Side by side is fine; they never overlap.")}
      {check("hitShootsAgain", "A hit earns another shot", "Off: shots strictly alternate.")}
      <Button className="btn primary" why={busy ? "Starting it…" : busyWhy({ connected })}>
        {busy ? "Starting…" : "Start Battleship"}
      </Button>
    </form>
  );
}

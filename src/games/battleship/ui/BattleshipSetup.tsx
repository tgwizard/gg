import { useState } from "react";
import type { GameSetupProps } from "../../ui";
import type { BsConfig } from "../engine";
import "./battleship.css";

export function BattleshipSetup({ busy, disabled, onStart }: GameSetupProps<BsConfig>) {
  const [config, setConfig] = useState<BsConfig>({ turnSeconds: 30, placeSeconds: 120, shipsMayTouch: true, hitShootsAgain: false });
  const seconds = (key: "turnSeconds" | "placeSeconds", label: string, hint: string) => (
    <label className="field">
      <span>
        {label} <span className="hint">{hint}</span>
      </span>
      <input type="number" min={0} value={config[key]} onChange={(e) => setConfig({ ...config, [key]: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
    </label>
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
        {seconds("turnSeconds", "Turn timer", "seconds, 0 = off")}
        {seconds("placeSeconds", "Placement timer", "seconds, 0 = off")}
      </div>
      {check("shipsMayTouch", "Ships may touch", "Side by side is fine; they never overlap.")}
      {check("hitShootsAgain", "A hit earns another shot", "Off: shots strictly alternate.")}
      <button className="btn primary" disabled={busy || disabled}>
        {busy ? "Starting…" : "Start Battleship"}
      </button>
    </form>
  );
}

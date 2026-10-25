import { useState } from "react";

/** `sendOp`, plus whether one of yours is on its way (to disable buttons meanwhile). */
export function useSend<Op>(sendOp: (op: Op) => Promise<boolean>) {
  const [busy, setBusy] = useState(false);
  const send = async (op: Op) => {
    setBusy(true);
    const ok = await sendOp(op);
    setBusy(false);
    return ok;
  };
  return { busy, send };
}

/**
 * Your move, shown at once before the server has it. It belongs to the game as it was
 * when you made it (this game, this version, played as you): it's gone once the game
 * changes, which is when the server's own board takes over, or when the move fails.
 */
export function usePending<Move>(snapshot: { instanceId: string; version: number }, me: string) {
  const at = `${snapshot.instanceId}:${snapshot.version}:${me}`;
  const [held, setHeld] = useState<{ at: string; move: Move } | null>(null);
  const pending = held?.at === at ? held.move : null;
  const play = async (move: Move, send: () => Promise<boolean>) => {
    const mine = { at, move };
    setHeld(mine);
    const ok = await send();
    setHeld((h) => (h === mine ? null : h));
    return ok;
  };
  return { pending, play };
}

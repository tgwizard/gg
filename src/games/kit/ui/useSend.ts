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

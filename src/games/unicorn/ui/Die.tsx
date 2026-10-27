import { useEffect, useRef, useState } from "react";
import { Button } from "../../../ui";
import { TUMBLE_MS } from "./motion";

/** Pips on a face, as cells of a 3×3 grid. */
const PIPS: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
/** Where each face is on the cube (opposite faces add up to 7, as on a real die)… */
const SIDE: Record<number, string> = { 1: "rotateY(0deg)", 6: "rotateY(180deg)", 2: "rotateY(90deg)", 5: "rotateY(-90deg)", 3: "rotateX(90deg)", 4: "rotateX(-90deg)" };
/** …and how the cube turns to show it to you, as [x, y] degrees. */
const SHOW: Record<number, [number, number]> = { 1: [0, 0], 6: [0, 180], 2: [0, -90], 5: [0, 90], 3: [-90, 0], 4: [90, 0] };

/**
 * The die: a cube with real faces, and the button to roll it. A roll that arrives while
 * you watch (`tumbling`) spins it a couple of times over before it settles on the number;
 * pressing it shakes it while the roll is on its way. When it isn't yours to roll, `why`
 * says so.
 */
export function Die(props: { value: number | null; tumbling: boolean; settled: boolean; rainbow: boolean; ready: boolean; why: string | null; onRoll(): void }) {
  const { value, tumbling } = props;
  // Whole turns added each roll, so it always spins forwards to the new face.
  const [turns, setTurns] = useState(0);
  const [shaking, setShaking] = useState(false);
  const was = useRef(tumbling);
  useEffect(() => {
    if (tumbling && !was.current) {
      setTurns((t) => t + 2);
      setShaking(false);
    }
    was.current = tumbling;
  }, [tumbling]);
  useEffect(() => {
    if (!shaking) return;
    const t = setTimeout(() => setShaking(false), 3000);
    return () => clearTimeout(t);
  }, [shaking]);
  const [x, y] = SHOW[value ?? 1]!;
  return (
    <Button
      className={`uni-die ${tumbling ? "tumbling" : ""} ${shaking ? "shaking" : ""} ${props.ready ? "ready" : ""} ${props.rainbow ? "rainbow" : ""}`}
      why={props.why}
      onClick={() => {
        setShaking(true);
        props.onRoll();
      }}
      aria-label={props.ready ? "Roll the die" : value ? `The die: ${value}` : "The die"}
      data-testid="uni-die"
      // The number, once it has landed (a roll just in hasn't started tumbling yet).
      data-value={props.settled && value !== null ? value : undefined}
    >
      <span className="uni-die-scene">
        <span className="uni-cube" style={{ transform: `rotateX(${x + turns * 360}deg) rotateY(${y + turns * 360}deg)`, transitionDuration: tumbling ? `${TUMBLE_MS}ms` : "0ms" }}>
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <span key={n} className="uni-face" style={{ transform: `${SIDE[n]} translateZ(var(--half))` }}>
              {Array.from({ length: 9 }, (_, i) => (
                <span key={i} className={PIPS[n]!.includes(i) ? "pip" : undefined} />
              ))}
            </span>
          ))}
        </span>
      </span>
    </Button>
  );
}

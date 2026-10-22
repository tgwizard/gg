import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PixelPaths } from "./pixels";

/**
 * Fills its box with pixel art drawn by `draw(cols, rows)`. The grid is sized from the
 * box so art pixels stay square at about `pixel` CSS pixels each. `drawKey` names the
 * drawing: change it when `draw` would paint something different.
 */
export function PixelArt({
  draw,
  drawKey,
  pixel = 6,
  className,
}: {
  draw(cols: number, rows: number): PixelPaths;
  drawKey: string;
  pixel?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [grid, setGrid] = useState<{ cols: number; rows: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current!;
    const measure = () => {
      const cols = Math.max(4, Math.round(el.clientWidth / pixel));
      const rows = Math.max(4, Math.round(el.clientHeight / pixel));
      setGrid((g) => (g && g.cols === cols && g.rows === rows ? g : { cols, rows }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pixel]);

  const paths = useMemo(() => (grid ? draw(grid.cols, grid.rows) : []), [grid?.cols, grid?.rows, drawKey]);

  return (
    <div ref={ref} className={`pixel-art ${className ?? ""}`} aria-hidden>
      {grid && (
        <svg viewBox={`0 0 ${grid.cols} ${grid.rows}`} preserveAspectRatio="none" shapeRendering="crispEdges">
          {paths.map((p) => (
            <path key={p.fill} fill={p.fill} d={p.d} />
          ))}
        </svg>
      )}
    </div>
  );
}

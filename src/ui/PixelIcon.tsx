import { memo } from "react";
import { ICONS, type IconName, iconPaths } from "./icons";

const cache = new Map<IconName, ReturnType<typeof iconPaths>>();

/**
 * A pixel-art icon. `scale` is CSS pixels per art pixel (2 by default), so icons
 * stay on the pixel grid instead of being resized to arbitrary sizes.
 */
export const PixelIcon = memo(function PixelIcon({
  name,
  scale = 2,
  title,
  className,
}: {
  name: IconName;
  scale?: number;
  title?: string;
  className?: string;
}) {
  const rows = ICONS[name];
  let paths = cache.get(name);
  if (!paths) cache.set(name, (paths = iconPaths(rows)));
  const w = Math.max(...rows.map((r) => r.length));
  const h = rows.length;
  return (
    <svg
      className={`px-icon ${className ?? ""}`}
      width={w * scale}
      height={h * scale}
      viewBox={`0 0 ${w} ${h}`}
      shapeRendering="crispEdges"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {paths.map((p) => (
        <path key={p.fill} fill={p.fill} d={p.d} />
      ))}
    </svg>
  );
});

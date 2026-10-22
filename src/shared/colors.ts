/**
 * Player colors: a fixed palette everyone picks from. Your pick is a preference; in a
 * room, the first member with a color keeps it and later ones get the next free one.
 */
export interface PlayerColor {
  name: string;
  /** The color itself (swatches, avatars, light surfaces). */
  hex: string;
  /** Readable text on top of it. */
  ink: string;
}

const LIGHT = "#fffaf2";
const DARK = "#2b2219";

export const PLAYER_COLORS: readonly PlayerColor[] = [
  { name: "Terracotta", hex: "#c8643b", ink: LIGHT },
  { name: "Tomato", hex: "#c23b3b", ink: LIGHT },
  { name: "Rose", hex: "#d4607e", ink: LIGHT },
  { name: "Plum", hex: "#8e4585", ink: LIGHT },
  { name: "Lavender", hex: "#8a78d6", ink: LIGHT },
  { name: "Indigo", hex: "#4657b0", ink: LIGHT },
  { name: "Sky", hex: "#3a91cf", ink: LIGHT },
  { name: "Teal", hex: "#23918a", ink: LIGHT },
  { name: "Mint", hex: "#4fbf94", ink: DARK },
  { name: "Forest", hex: "#3d7a46", ink: LIGHT },
  { name: "Olive", hex: "#93a53a", ink: DARK },
  { name: "Mustard", hex: "#e0b03c", ink: DARK },
  { name: "Orange", hex: "#e88a2e", ink: DARK },
  { name: "Caramel", hex: "#9a6a3f", ink: LIGHT },
  { name: "Slate", hex: "#5d6b7c", ink: LIGHT },
  { name: "Charcoal", hex: "#45403b", ink: LIGHT },
];

export const COLOR_COUNT = PLAYER_COLORS.length;

export const isColor = (c: unknown): c is number => Number.isInteger(c) && (c as number) >= 0 && (c as number) < COLOR_COUNT;

/**
 * Resolve preferences into colors, in join order: each member gets their preferred
 * color unless someone earlier has it, then the next free one around the palette.
 * Once every color is taken, preferences are honored as-is.
 */
export function assignColors(members: readonly { id: string; preferred: number }[]): Map<string, number> {
  const taken = new Set<number>();
  const result = new Map<string, number>();
  for (const m of members) {
    let color = isColor(m.preferred) ? m.preferred : 0;
    if (taken.size < COLOR_COUNT) {
      for (let step = 0; step < COLOR_COUNT && taken.has(color); step++) color = (color + 1) % COLOR_COUNT;
    }
    taken.add(color);
    result.set(m.id, color);
  }
  return result;
}

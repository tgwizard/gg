/** Test helpers shared by all games. */

/** Small seeded PRNG (mulberry32) so failures reproduce. */
export function seededRandomInt(seed: number) {
  let a = seed >>> 0;
  return (maxExclusive: number) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return Math.floor(r * maxExclusive);
  };
}

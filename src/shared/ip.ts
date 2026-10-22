/**
 * The key per-IP limits are counted under. IPv6 users typically get a whole /64
 * (and anyone with a VPS can rotate through one freely), so all addresses in a /64
 * share a key; IPv4 addresses are used as-is.
 */
export function ipKey(ip: string): string {
  if (!ip.includes(":")) return ip;
  const [head = "", tail = ""] = ip.toLowerCase().split("%")[0]!.split("::");
  const left = head ? head.split(":") : [];
  const right = ip.includes("::") && tail ? tail.split(":") : [];
  // An embedded IPv4 tail (::ffff:1.2.3.4) is two groups; it never reaches the first four.
  const groups = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  return `${groups
    .slice(0, 4)
    .map((g) => (parseInt(g, 16) || 0).toString(16))
    .join(":")}::/64`;
}

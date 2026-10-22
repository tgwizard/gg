/**
 * Room codes: 10 characters from Crockford's base32 alphabet (digits and upper-case
 * letters without I, L, O, U), so they're easy to read aloud and type. That's 50
 * bits: with per-IP rate limits on lookups, guessing a live room isn't practical.
 *
 * Input is forgiving: case-insensitive, spaces and dashes ignored, and the
 * look-alikes people type by mistake map to what they meant (O→0, I/L→1).
 */
export const ROOM_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const ROOM_CODE_LENGTH = 10;

const VALID = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

export function generateRoomCode(): string {
  // 32 symbols divide 256 evenly, so masking a random byte has no bias.
  const bytes = crypto.getRandomValues(new Uint8Array(ROOM_CODE_LENGTH));
  return Array.from(bytes, (b) => ROOM_CODE_ALPHABET[b & 31]).join("");
}

/** The canonical code for user input, or null if it can't be one. */
export function normalizeRoomCode(input: string): string | null {
  const code = input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  return VALID.test(code) ? code : null;
}

/** Find a room code in a pasted link or a typed code. */
export function roomCodeFromInput(input: string): string | null {
  const trimmed = input.trim();
  const fromLink = trimmed.match(/\/r\/([^/?#\s]+)/i)?.[1];
  return normalizeRoomCode(fromLink ?? trimmed);
}

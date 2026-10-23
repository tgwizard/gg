/** Public id = truncated SHA-256 of a secret, so ids can't be spoofed. Browsers use it to recognise their own bots. */
export async function playerIdFromSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return [...new Uint8Array(digest).slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

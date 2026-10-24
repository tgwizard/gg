/**
 * Not a test: captures screenshots of the main screens for visual QA.
 *   node test/e2e/screens.ts <baseURL> <outDir>
 */
import { chromium, devices } from "@playwright/test";

const [base = "http://localhost:5311", out = "screens"] = process.argv.slice(2);
const browser = await chromium.launch();
const ctx = (mobile = false) => browser.newContext({ ...(mobile ? devices["Pixel 7"] : { viewport: { width: 1280, height: 800 } }), baseURL: base });

const a = await (await ctx()).newPage();
await a.goto("/");
await a.screenshot({ path: `${out}/1-home.png` });
await a.getByLabel("Your name").fill("Alice");
await a.getByRole("button", { name: "Create a room" }).click();
await a.waitForURL(/\/r\//);
const url = a.url();

const players = [a];
for (const name of ["Bob", "Carol", "Dave"]) {
  const p = await (await ctx(name === "Dave")).newPage();
  await p.goto(url);
  await p.getByLabel("Your name").fill(name);
  await p.getByRole("button", { name: "Join room" }).click();
  players.push(p);
}
await a.getByTestId("connection-status").filter({ hasText: "Connected" }).waitFor({ state: "attached" });
await players[1]!.getByLabel("Chat message").fill("evening all 👋");
await players[1]!.getByLabel("Chat message").press("Enter");
await a.waitForTimeout(300);
await a.screenshot({ path: `${out}/2-room-picker.png` });

await a.getByRole("button", { name: /Texas Hold'em/ }).click();
await a.screenshot({ path: `${out}/3-setup.png` });
await a.getByRole("button", { name: "Open the table" }).click();
for (const [i, seat] of [0, 3, 5].entries()) {
  await players[i]!.getByTestId(`seat-${seat}`).getByRole("button", { name: "Sit here" }).click();
  await players[i]!.locator(".seat.me").waitFor();
}
await a.getByRole("button", { name: "Deal" }).click();
await a.waitForTimeout(500);
// Make some action happen: whoever is to act raises, next calls.
for (let k = 0; k < 2; k++) {
  for (const p of players.slice(0, 3)) {
    if (await p.getByTestId("actions").isVisible()) {
      const raise = p.getByRole("button", { name: /^Raise to/ });
      await ((await raise.isVisible()) && k === 0 ? raise : p.getByRole("button", { name: /^Call|^Check/ })).click();
      await p.waitForTimeout(300);
      break;
    }
  }
}
await a.waitForTimeout(300);
for (const [i, p] of players.entries()) await p.screenshot({ path: `${out}/4-table-${i}.png`, fullPage: i === 3 });
await browser.close();
console.log("ok", url);

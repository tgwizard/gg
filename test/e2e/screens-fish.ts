/**
 * Not a test: screenshots of Finns i sjön for visual QA.
 *   node test/e2e/screens-fish.ts <baseURL> <outDir>
 */
import { chromium, devices, type Page } from "@playwright/test";

const [base = "http://localhost:5311", out = "screens"] = process.argv.slice(2);
const browser = await chromium.launch();
const ctx = async (mobile = false) =>
  (
    await browser.newContext({
      ...(mobile ? devices["Pixel 7"] : { viewport: { width: 1280, height: 860 } }),
      baseURL: base,
      extraHTTPHeaders: { "CF-Connecting-IP": `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
    })
  ).newPage();

const a = await ctx();
await a.goto("/");
await a.getByLabel("Your name").fill("Alice");
await a.getByRole("button", { name: "Create a room" }).click();
await a.waitForURL(/\/r\//);
const url = a.url();
const players: Page[] = [a];
for (const name of ["Bob", "Carol"]) {
  const p = await ctx(name === "Carol");
  await p.goto(url);
  await p.getByLabel("Your name").fill(name);
  await p.getByRole("button", { name: "Join room" }).click();
  await p.getByText("Connected").waitFor();
  players.push(p);
}
await a.getByRole("button", { name: /Finns i sjön/ }).click();
await a.getByRole("button", { name: "Open the table" }).click();
for (const [i, p] of players.entries()) {
  await p.getByTestId(`fish-seat-${i}`).getByRole("button", { name: "Sit here" }).click();
  await p.waitForTimeout(200);
}
await a.screenshot({ path: `${out}/fish-1-lobby.png` });
await a.getByRole("button", { name: "Deal" }).click();
await a.waitForTimeout(600);

// Play a few asks: whoever can ask picks their first card and the first opponent.
for (let k = 0; k < 4; k++) {
  for (const p of players) {
    const askBtn = p.getByTestId("fish-ask").getByRole("button");
    if (await askBtn.isVisible().catch(() => false)) {
      const card = p.locator(".fish-card:not([disabled])").first();
      if (!(await card.isVisible().catch(() => false))) continue;
      await card.click();
      const opp = p.locator(".fish-opp.selectable").first();
      if (await opp.isVisible()) await opp.click();
      if (k === 1) await p.screenshot({ path: `${out}/fish-2-asking.png` });
      if (await askBtn.isEnabled()) await askBtn.click();
      await p.waitForTimeout(400);
      break;
    }
  }
}
for (const [i, p] of players.entries()) await p.screenshot({ path: `${out}/fish-3-table-${i}.png`, fullPage: i === 2 });
await browser.close();
console.log("ok", url);

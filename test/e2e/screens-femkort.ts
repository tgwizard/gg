/**
 * Not a test: screenshots of Fem kort for visual QA, in light and dark mode, from the
 * /try positions (so it needs the dev server).
 *   node test/e2e/screens-femkort.ts <baseURL> <outDir>
 */
import { chromium, devices, type Page } from "@playwright/test";

const [base = "http://localhost:5311", out = "screens"] = process.argv.slice(2);
const browser = await chromium.launch();
const ctx = async (mobile = false) =>
  (
    await browser.newContext({
      ...(mobile ? devices["Pixel 7"] : { viewport: { width: 1440, height: 900 } }),
      baseURL: base,
      extraHTTPHeaders: { "CF-Connecting-IP": `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
    })
  ).newPage();

async function snap(p: Page, name: string, fullPage = true) {
  for (const mode of ["light", "dark"] as const) {
    await p.emulateMedia({ colorScheme: mode });
    await p.waitForTimeout(150);
    await p.screenshot({ path: `${out}/${name}-${mode}.png`, fullPage });
  }
  await p.emulateMedia({ colorScheme: "light" });
}

async function open(p: Page, scenario: string) {
  await p.goto(`/try/femkort/${scenario}`);
  await p.getByTestId("fem-table").waitFor({ timeout: 20_000 });
  await p.waitForTimeout(600);
}

const myTurn = (p: Page) => p.locator(".fem-hint.your-turn").waitFor({ timeout: 20_000 });
const playFirst = (p: Page) => p.locator(".fem-card[data-playable]").first().click();

const a = await ctx();
await open(a, "first-deal");
await myTurn(a);
await a.waitForTimeout(1200);
await snap(a, "femkort-1-first-deal");
await playFirst(a);
await a.waitForTimeout(250);
await a.screenshot({ path: `${out}/femkort-2-card-flying.png` });
// The bots follow; the trick is held a moment, then gathered.
await a.locator('[data-testid^="fem-played-"]').nth(2).waitFor({ timeout: 10_000 });
await a.waitForTimeout(500);
await snap(a, "femkort-3-trick-taken");

// Play the deal out: the last trick and a deal won.
for (let i = 0; i < 12 && !(await a.getByTestId("fem-deal-won").isVisible()); i++) {
  await Promise.race([myTurn(a), a.getByTestId("fem-deal-won").waitFor({ timeout: 20_000 })]);
  if (await a.getByTestId("fem-deal-won").isVisible()) break;
  if (await a.getByTestId("fem-last-trick").isVisible()) await snap(a, "femkort-4-last-trick-turn");
  await playFirst(a);
  await a.waitForTimeout(400);
}
await a.waitForTimeout(1800);
await snap(a, "femkort-5-deal-won");

await open(a, "fourth-trick");
await myTurn(a);
await snap(a, "femkort-6-fourth-trick");

await open(a, "last-trick");
await myTurn(a);
await a.waitForTimeout(1200);
await snap(a, "femkort-7-last-trick");
await playFirst(a);
await a.getByTestId("fem-result").waitFor({ timeout: 20_000 });
await a.waitForTimeout(2500);
await snap(a, "femkort-8-result");

await open(a, "better-cards");
await myTurn(a);
await a.getByTestId("fem-ask").click();
await a.waitForTimeout(400);
await snap(a, "femkort-9-better-cards");

const m = await ctx(true);
await open(m, "first-deal");
await myTurn(m);
await m.waitForTimeout(1200);
await snap(m, "femkort-10-phone");
await open(m, "last-trick");
await myTurn(m);
await m.waitForTimeout(1200);
await snap(m, "femkort-11-phone-last-trick");
await playFirst(m);
await m.getByTestId("fem-result").waitFor({ timeout: 20_000 });
await m.waitForTimeout(2500);
await m.evaluate(() => scrollTo(0, 0));
await snap(m, "femkort-12-phone-result", false);
await browser.close();

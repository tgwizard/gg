/**
 * Not a test: screenshots of Othello for visual QA, in light and dark mode, from the
 * /try positions (so it needs the dev server).
 *   node test/e2e/screens-othello.ts <baseURL> <outDir>
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
  await p.goto(`/try/othello/${scenario}`);
  await p.getByTestId("othello-board").waitFor({ timeout: 20_000 });
  await p.waitForTimeout(600);
}

const yourMove = (p: Page) => p.getByTestId("othello-status").filter({ hasText: "Your move." }).waitFor({ timeout: 20_000 });

const a = await ctx();
await open(a, "opening");
await yourMove(a);
await snap(a, "othello-1-opening");
// Pointing at a move shows the disc and what it turns over.
await a.getByTestId("othello-sq-d3").hover();
await a.waitForTimeout(300);
await a.screenshot({ path: `${out}/othello-2-hover.png` });
await a.getByTestId("othello-sq-d3").click();
await a.waitForTimeout(260);
await a.screenshot({ path: `${out}/othello-3-flipping.png` });
await a.mouse.move(0, 0);
await yourMove(a);
await a.waitForTimeout(900);
await snap(a, "othello-4-after-bot");

await open(a, "pass");
await yourMove(a);
await snap(a, "othello-5-pass");

await open(a, "last-move");
await yourMove(a);
await a.locator(".oth-sq.legal").first().click();
await a.getByTestId("othello-result").waitFor({ timeout: 20_000 });
await a.waitForTimeout(2500);
await snap(a, "othello-6-result");

const m = await ctx(true);
await open(m, "corner");
await yourMove(m);
await snap(m, "othello-7-phone");
await browser.close();

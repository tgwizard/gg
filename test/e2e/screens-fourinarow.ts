/**
 * Not a test: screenshots of Four in a Row for visual QA, in light and dark mode, from
 * the /try positions (so it needs the dev server).
 *   node test/e2e/screens-fourinarow.ts <baseURL> <outDir>
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
  await p.goto(`/try/fourinarow/${scenario}`);
  await p.getByTestId("fiar-board").waitFor({ timeout: 20_000 });
  await p.waitForTimeout(600);
}

const yourMove = (p: Page) => p.getByTestId("fiar-status").filter({ hasText: "Your move." }).waitFor({ timeout: 20_000 });

const a = await ctx();
await open(a, "opening");
await yourMove(a);
await snap(a, "fiar-1-opening");
// Pointing at a column holds your disc over it and marks where it lands.
await a.getByTestId("fiar-col-4").hover();
await a.waitForTimeout(300);
await a.screenshot({ path: `${out}/fiar-2-hover.png` });
await a.getByTestId("fiar-col-4").click();
await a.waitForTimeout(150);
await a.screenshot({ path: `${out}/fiar-3-falling.png` });
await a.mouse.move(0, 0);
await yourMove(a);
await a.waitForTimeout(900);
await snap(a, "fiar-4-after-bot");

await open(a, "block");
await yourMove(a);
await snap(a, "fiar-5-block");

await open(a, "win");
await yourMove(a);
await snap(a, "fiar-6-win-in-one");

await open(a, "game-over");
await a.getByTestId("fiar-result").waitFor({ timeout: 20_000 });
await a.waitForTimeout(1500);
await snap(a, "fiar-7-result");
await a.getByRole("button", { name: "See the board" }).click();
await a.waitForTimeout(400);
await snap(a, "fiar-8-line");

await open(a, "big-board");
await yourMove(a);
await snap(a, "fiar-9-big-board");

const m = await ctx(true);
await open(m, "block");
await yourMove(m);
await snap(m, "fiar-10-phone");
await open(m, "game-over");
await m.getByTestId("fiar-result").waitFor({ timeout: 20_000 });
await m.waitForTimeout(1500);
await snap(m, "fiar-11-phone-result");
await browser.close();

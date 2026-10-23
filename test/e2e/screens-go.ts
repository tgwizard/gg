/**
 * Not a test: screenshots of Go for visual QA, in light and dark mode, from the /try
 * positions (so it needs the dev server).
 *   node test/e2e/screens-go.ts <baseURL> <outDir>
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
  await p.goto(`/try/go/${scenario}`);
  await p.getByTestId("go-board").waitFor({ timeout: 30_000 });
  await p.waitForTimeout(600);
}

const yourMove = (p: Page) => p.getByTestId("go-status").filter({ hasText: "Your move." }).waitFor({ timeout: 30_000 });

const a = await ctx();
await open(a, "opening");
await yourMove(a);
await snap(a, "go-1-opening");
await a.getByTestId("go-pt-E5").hover();
await a.waitForTimeout(200);
await a.screenshot({ path: `${out}/go-2-hover.png` });
await a.getByTestId("go-pt-E5").click();
await a.mouse.move(0, 0);
await yourMove(a);
await a.waitForTimeout(600);
await snap(a, "go-3-after-bot");

await open(a, "capture");
await yourMove(a);
await snap(a, "go-4-capture");

await open(a, "ko");
await yourMove(a);
await snap(a, "go-5-ko");

await open(a, "counting");
await a.getByTestId("go-score").waitFor({ timeout: 30_000 });
await snap(a, "go-6-counting");

await open(a, "game-over");
await a.getByTestId("go-result").waitFor({ timeout: 30_000 });
await a.waitForTimeout(2500);
await snap(a, "go-7-result");

await open(a, "big-board");
await yourMove(a);
await snap(a, "go-8-big");

const m = await ctx(true);
await open(m, "big-board");
await yourMove(m);
await snap(m, "go-9-phone-big");
await open(m, "capture");
await yourMove(m);
await snap(m, "go-10-phone");
await browser.close();

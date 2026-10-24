/**
 * Not a test: screenshots of Luffarschack for visual QA, in light and dark mode, from
 * the /try positions (so it needs the dev server).
 *   node test/e2e/screens-luffarschack.ts <baseURL> <outDir>
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
  await p.goto(`/try/luffarschack/${scenario}`);
  await p.getByTestId("lfs-sheet").waitFor({ timeout: 20_000 });
  await p.waitForTimeout(600);
}

const yourMove = (p: Page) => p.getByTestId("lfs-status").filter({ hasText: "Your move." }).waitFor({ timeout: 20_000 });

/** Point at a square of the sheet (column letter and row from the top), from the square's middle. */
async function at(p: Page, square: string): Promise<{ x: number; y: number }> {
  const svg = p.locator(".lfs-svg");
  const box = (await svg.boundingBox())!;
  const vb = (await svg.getAttribute("viewBox"))!.split(" ").map(Number) as [number, number, number, number];
  const col = square.charCodeAt(0) - 65;
  const row = Number(square.slice(1)) - 1;
  return { x: box.x + ((col * 100 + 50 - vb[0]) / vb[2]) * box.width, y: box.y + ((row * 100 + 50 - vb[1]) / vb[3]) * box.height };
}

const a = await ctx();
await open(a, "opening");
await yourMove(a);
await snap(a, "lfs-1-opening");
// Pointing at a square pencils your mark in.
const k10 = await at(a, "K10");
await a.mouse.move(k10.x, k10.y);
await a.waitForTimeout(300);
await a.screenshot({ path: `${out}/lfs-2-hover.png` });
await a.mouse.click(k10.x, k10.y);
await a.waitForTimeout(160);
await a.screenshot({ path: `${out}/lfs-3-drawing.png` });
await a.mouse.move(0, 0);
await yourMove(a);
await a.waitForTimeout(900);
await snap(a, "lfs-4-after-bot");

await open(a, "block");
await yourMove(a);
await snap(a, "lfs-5-block");

await open(a, "open-three");
await yourMove(a);
await snap(a, "lfs-6-open-three");

await open(a, "game-over");
await a.getByTestId("lfs-result").waitFor({ timeout: 20_000 });
await a.waitForTimeout(1500);
await snap(a, "lfs-7-result");
await a.getByRole("button", { name: "See the board" }).click();
await a.waitForTimeout(400);
await snap(a, "lfs-8-ringed");

await open(a, "big-sheet");
await yourMove(a);
await snap(a, "lfs-9-big-sheet");

await open(a, "small-sheet");
await yourMove(a);
await snap(a, "lfs-10-small-sheet");

const m = await ctx(true);
await open(m, "block");
await yourMove(m);
await snap(m, "lfs-11-phone");
await open(m, "game-over");
await m.getByTestId("lfs-result").waitFor({ timeout: 20_000 });
await m.waitForTimeout(1500);
await m.getByRole("button", { name: "See the board" }).click();
await m.waitForTimeout(400);
await snap(m, "lfs-12-phone-ringed");
await browser.close();

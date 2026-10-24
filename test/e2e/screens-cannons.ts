/**
 * Not a test: screenshots of Cannons for visual QA, in light and dark mode, from the
 * /try positions (so it needs the dev server).
 *   node test/e2e/screens-cannons.ts <baseURL> <outDir>
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
  await p.goto(`/try/cannons/${scenario}`);
  await p.getByTestId("cannons-scene").waitFor({ timeout: 20_000 });
  await p.waitForTimeout(600);
}

const yourShot = (p: Page) => p.getByTestId("cannons-fire").waitFor({ timeout: 30_000 });

const a = await ctx();
await open(a, "first-shot");
await yourShot(a);
await snap(a, "cannons-1-first-shot");
// Dragging from the cannon aims.
const box = (await a.getByTestId("cannons-scene").boundingBox())!;
const cannon = (await a.getByTestId("cannons-cannon-0").boundingBox())!;
await a.mouse.move(cannon.x + cannon.width / 2, cannon.y);
await a.mouse.down();
await a.mouse.move(cannon.x + cannon.width / 2 + box.width * 0.12, cannon.y - box.height * 0.2, { steps: 6 });
await a.waitForTimeout(200);
await a.screenshot({ path: `${out}/cannons-2-aiming.png` });
await a.mouse.up();
// Then a high lob, set with the keys: angle 65, power 80.
const setTo = async (testId: string, read: (el: Element) => number, want: number, more: string, less: string) => {
  for (let i = 0; i < 200; i++) {
    const now = await a.getByTestId(testId).evaluate(read);
    if (now === want) return;
    await a.keyboard.press(now < want ? more : less);
  }
};
await setTo("cannons-angle", (el) => Number(el.getAttribute("aria-label")!.replace(/\D/g, "")), 65, "ArrowLeft", "ArrowRight");
await setTo("cannons-power", (el) => Number(el.textContent), 80, "ArrowUp", "ArrowDown");
await a.getByTestId("cannons-fire").click();
await a.waitForTimeout(1300);
await a.screenshot({ path: `${out}/cannons-3-flying.png` });
await a.waitForTimeout(2600);
await a.screenshot({ path: `${out}/cannons-4-landed.png` });
await a.mouse.move(0, 0);

await open(a, "mid-game");
await yourShot(a);
await snap(a, "cannons-5-mid-game");

await open(a, "mountains");
await yourShot(a);
await snap(a, "cannons-6-mountains");

await open(a, "free-for-all");
await yourShot(a);
await snap(a, "cannons-7-free-for-all");

await open(a, "game-over");
await a.getByTestId("cannons-result").waitFor({ timeout: 20_000 });
await a.waitForTimeout(800);
await snap(a, "cannons-8-result");

const m = await ctx(true);
await open(m, "mid-game");
await yourShot(m);
await snap(m, "cannons-9-phone");
await open(m, "free-for-all");
await yourShot(m);
await snap(m, "cannons-10-phone-ffa");
await browser.close();

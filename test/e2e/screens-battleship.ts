/**
 * Not a test: screenshots of Battleship for visual QA, in light and dark mode.
 *   node test/e2e/screens-battleship.ts <baseURL> <outDir>
 */
import { chromium, devices, type Page } from "@playwright/test";

const [base = "http://localhost:5311", out = "screens"] = process.argv.slice(2);
const browser = await chromium.launch();
const ctx = async (mobile = false) =>
  (
    await browser.newContext({
      ...(mobile ? devices["Pixel 7"] : { viewport: { width: 1280, height: 860 } }),
      baseURL: base,
      extraHTTPHeaders: { "CF-Connecting-IP": `10.7.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
    })
  ).newPage();

/** Light and dark shots of the same moment. */
async function snap(p: Page, name: string, fullPage = false) {
  for (const mode of ["light", "dark"] as const) {
    await p.emulateMedia({ colorScheme: mode });
    await p.waitForTimeout(150);
    await p.screenshot({ path: `${out}/${name}-${mode}.png`, fullPage });
  }
  await p.emulateMedia({ colorScheme: "light" });
}

/** The cells of the fleet a player can see in their own waters. */
const ownCells = (p: Page, side: number) =>
  p.getByTestId(`bs-board-${side}`).locator(".bs-ship").evaluateAll((els) => els.flatMap((e) => e.getAttribute("data-cells")!.split(" ").map(Number)));

const a = await ctx();
await a.goto("/");
await a.getByLabel("Your name").fill("Alice");
await a.getByRole("button", { name: "Create a room" }).click();
await a.waitForURL(/\/r\//);
const url = a.url();
const b = await ctx(true);
await b.goto(url);
await b.getByLabel("Your name").fill("Bob");
await b.getByRole("button", { name: "Join room" }).click();
await b.getByText("Connected").waitFor();

await a.getByRole("button", { name: /Battleship/ }).click();
await a.screenshot({ path: `${out}/bs-0-setup.png` });
await a.getByRole("button", { name: "Start Battleship" }).click();
await snap(a, "bs-1-pick");
await a.getByRole("button", { name: "Take a seat" }).click();
await b.getByRole("button", { name: "Take a seat" }).click();

// Alice places two ships by hand and hovers the third; Bob goes random and readies up.
await a.getByTestId("bs-dock").waitFor();
await a.getByTestId("bs-cell-0-11").click();
await a.waitForTimeout(200);
await a.getByRole("button", { name: /Rotate/ }).click();
await a.getByTestId("bs-cell-0-37").click();
await a.waitForTimeout(200);
await a.getByTestId("bs-cell-0-64").hover();
await b.getByRole("button", { name: "Random" }).click();
await b.waitForTimeout(200);
await snap(b, "bs-2-placing-mobile", true);
await b.getByRole("button", { name: "Ready" }).click();
await a.waitForTimeout(300);
await snap(a, "bs-2-placing");

await a.getByRole("button", { name: "Random" }).click();
await a.waitForTimeout(200);
await a.getByRole("button", { name: "Ready" }).click();
await a.getByTestId("bs-status").waitFor();

// Alice knows exactly where Bob's ships are (from Bob's own screen); Bob fires at the left columns.
const bobShips = await ownCells(b, 1);
const aliceShips = new Set(await ownCells(a, 0));
const bobTargets = Array.from({ length: 100 }, (_, i) => i).filter((c) => !aliceShips.has(c));
bobTargets.splice(3, 0, ...[...aliceShips].slice(0, 2)); // a couple of hits for Bob
const shoot = async (p: Page, side: number, cell: number) => {
  await p.getByTestId(`bs-cell-${side}-${cell}`).click();
  await p.getByTestId(`bs-cell-${side}-${cell}`).and(p.locator("[data-shot]")).waitFor();
};
const aliceTargets = [...new Set([55, ...bobShips])];
for (let i = 0; ; i++) {
  await shoot(a, 1, aliceTargets[i]!);
  if (await a.getByTestId("bs-result").isVisible()) break;
  await shoot(b, 0, bobTargets[i]!);
  if (i === 7) {
    await a.waitForTimeout(200);
    await snap(a, "bs-3-firing");
    await snap(b, "bs-3-firing-mobile", true);
  }
}
await a.waitForTimeout(400);
await snap(a, "bs-4-over");
await snap(b, "bs-4-over-mobile", true);
await browser.close();
console.log("ok", url);

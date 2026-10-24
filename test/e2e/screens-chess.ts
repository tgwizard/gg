/**
 * Not a test: screenshots of chess for visual QA, in light and dark mode.
 *   node test/e2e/screens-chess.ts <baseURL> <outDir>
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

/** Click a piece, then where it goes. */
async function move(p: Page, from: string, to: string) {
  await p.getByTestId(`chess-sq-${from}`).click();
  await p.getByTestId(`chess-sq-${to}`).click();
  await p.waitForTimeout(400);
}

/** Drag a piece there, like a person with a mouse. */
async function drag(p: Page, from: string, to: string) {
  const [a, b] = [await p.getByTestId(`chess-sq-${from}`).boundingBox(), await p.getByTestId(`chess-sq-${to}`).boundingBox()];
  await p.mouse.move(a!.x + a!.width / 2, a!.y + a!.height / 2);
  await p.mouse.down();
  await p.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2, { steps: 8 });
  await p.mouse.up();
  await p.waitForTimeout(400);
}

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
await b.getByTestId("connection-status").filter({ hasText: "Connected" }).waitFor({ state: "attached" });

await a.getByRole("button", { name: /^Chess/ }).click();
await a.getByRole("button", { name: "Blitz 5+3" }).click();
await a.waitForTimeout(400);
await a.screenshot({ path: `${out}/chess-0-setup.png` });
await a.getByRole("button", { name: "Start chess" }).click();
await a.getByTestId("chess-sit").click();
await a.waitForTimeout(300);
await snap(a, "chess-1-waiting");
await b.getByTestId("chess-sit").click();
await a.getByTestId("chess-clock-w").waitFor();

await drag(a, "e2", "e4");
await move(b, "e7", "e5");
await move(a, "g1", "f3");
await move(b, "b8", "c6");
await move(a, "f1", "c4");
await move(b, "g8", "f6");
await move(a, "e1", "h1"); // castles, king onto rook
await move(b, "f8", "c5");
await b.getByTestId("chess-offer-draw").click();
await a.getByTestId("chess-draw-offer").waitFor();
// Alice has her bishop picked up: the squares it can reach are marked.
await a.getByTestId("chess-sq-c4").click();
await snap(a, "chess-2-playing");
await a.getByRole("button", { name: "Decline" }).click();
// Bishop takes on f7, check: the taken pawn fades out.
await a.getByTestId("chess-sq-f7").click();
await b.waitForTimeout(120);
await b.screenshot({ path: `${out}/chess-2-taken-mobile.png` });
await a.waitForTimeout(600);
await snap(a, "chess-2-check");
await snap(b, "chess-2-check-mobile");
await b.getByTestId("chess-resign").click();
await b.getByTestId("chess-resign-yes").click();
await a.getByTestId("chess-result").waitFor();
await a.waitForTimeout(300);
await snap(a, "chess-3-over");
await a.getByRole("button", { name: "Hide chat" }).click();
await a.waitForTimeout(300);
await a.screenshot({ path: `${out}/chess-3-wide.png` });
await snap(b, "chess-3-over-mobile");
await browser.close();
console.log("ok", url);

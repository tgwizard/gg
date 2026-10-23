/**
 * Not a test: screenshots of Coast to Coast for visual QA, in light and dark mode.
 *   node test/e2e/screens-ticket.ts <baseURL> <outDir>
 */
import { chromium, devices, type Page } from "@playwright/test";

const [base = "http://localhost:5311", out = "screens"] = process.argv.slice(2);
const browser = await chromium.launch();
const ctx = async (mobile = false) =>
  (
    await browser.newContext({
      ...(mobile ? devices["Pixel 7"] : { viewport: { width: 1440, height: 900 } }),
      baseURL: base,
      extraHTTPHeaders: { "CF-Connecting-IP": `10.8.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
    })
  ).newPage();

/** Light and dark shots of the same moment. */
async function snap(p: Page, name: string, fullPage = true) {
  for (const mode of ["light", "dark"] as const) {
    await p.emulateMedia({ colorScheme: mode });
    await p.waitForTimeout(150);
    await p.screenshot({ path: `${out}/${name}-${mode}.png`, fullPage });
  }
  await p.emulateMedia({ colorScheme: "light" });
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
await b.getByText("Connected").waitFor();

await a.getByRole("button", { name: /Coast to Coast/ }).click();
await a.screenshot({ path: `${out}/ttr-0-setup.png` });
await a.getByRole("button", { name: "Open the table" }).click();
await a.getByTestId("ttr-seat-0").getByRole("button", { name: "Sit here" }).click();
await b.getByTestId("ttr-seat-2").getByRole("button", { name: "Sit here" }).click();
await a.waitForTimeout(300);
await snap(a, "ttr-1-lobby");
await a.getByTestId("ttr-start").click();

// Choosing tickets: Alice hovers one to see where it goes.
for (const p of [a, b]) await p.getByTestId("ttr-choose").waitFor();
const offers = a.getByTestId("ttr-offer");
await offers.nth(0).click();
await offers.nth(1).click();
await offers.nth(2).hover();
await snap(a, "ttr-2-choosing");
await snap(b, "ttr-2-choosing-mobile");
for (const p of [a, b]) {
  if (p === b) {
    await b.getByTestId("ttr-offer").nth(0).click();
    await b.getByTestId("ttr-offer").nth(1).click();
  }
  await p.getByTestId("ttr-keep").click();
}

/** The page whose turn it is (its deck can be drawn from). */
async function whoseTurn(): Promise<Page> {
  for (;;) {
    for (const p of [a, b]) if (await p.getByTestId("ttr-deck").isEnabled()) return p;
    await a.waitForTimeout(100);
  }
}

/** Whoever's turn it is: claim a route on offer (usually), else draw two blind cards. */
async function turn() {
  const p = await whoseTurn();
  const claimable = p.getByTestId("ttr-claimable");
  if ((await claimable.count()) > 0 && Math.random() < 0.7) {
    await claimable.last().dispatchEvent("click");
    await p.getByTestId("ttr-pay").first().click();
  } else {
    await p.getByTestId("ttr-deck").click();
    await p.waitForTimeout(150);
    await p.getByTestId("ttr-deck").click();
  }
  await p.waitForTimeout(250);
}

for (let i = 0; i < 30; i++) await turn();
// Whoever's turn it is picks a route to claim, if they can.
const next = await whoseTurn();
if ((await next.getByTestId("ttr-claimable").count()) > 0) await next.getByTestId("ttr-claimable").first().dispatchEvent("click");
await a.waitForTimeout(300);
await snap(a, "ttr-3-playing");
// What fits on a laptop screen without scrolling.
await a.evaluate(() => window.scrollTo(0, 0));
await a.screenshot({ path: `${out}/ttr-3-viewport.png` });
await a.getByRole("button", { name: "Hide chat" }).click();
await a.waitForTimeout(300);
await a.screenshot({ path: `${out}/ttr-3-viewport-wide.png` });
// A message while the chat is folded away pops up beside the rail.
await b.getByLabel("Chat message").fill("Nice route! I was going for that one.");
await b.getByLabel("Chat message").press("Enter");
await a.getByTestId("chat-popup").waitFor();
await a.waitForTimeout(400);
await a.screenshot({ path: `${out}/ttr-3-popup.png` });
await a.getByTestId("sidebar-rail").getByRole("button", { name: /Show chat/ }).click();
await snap(b, "ttr-3-playing-mobile");
await a.locator("details.game-log summary").dispatchEvent("click");
for (const p of [a, b]) await p.keyboard.press("Escape");
await a.waitForTimeout(300);
await a.screenshot({ path: `${out}/ttr-3-map.png`, clip: (await a.getByTestId("ttr-map").boundingBox())! });
await browser.close();
console.log("ok", url);

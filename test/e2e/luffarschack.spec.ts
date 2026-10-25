import { devices, expect, type Page, test } from "@playwright/test";
import { createRoom, joinRoom, newPlayer } from "./helpers";

/** Where a square ("C5": column letter, row from the top) is on screen. */
async function squareAt(page: Page, square: string): Promise<{ x: number; y: number }> {
  const svg = page.locator(".lfs-svg");
  const box = (await svg.boundingBox())!;
  const [x0, y0, w, h] = (await svg.getAttribute("viewBox"))!.split(" ").map(Number) as [number, number, number, number];
  const [col, row] = [square.charCodeAt(0) - 65, Number(square.slice(1)) - 1];
  return { x: box.x + ((col * 100 + 50 - x0) / w) * box.width, y: box.y + ((row * 100 + 50 - y0) / h) * box.height };
}

/** Once it's their move, click `square`. */
async function mark(page: Page, square: string) {
  await expect(page.getByTestId("lfs-status")).toHaveText("Your move.");
  const { x, y } = await squareAt(page, square);
  await page.mouse.click(x, y);
}

test("Luffarschack: sit, mark by click and keyboard, five in a row, play again", async ({ browser }) => {
  const alice = await newPlayer(browser);
  const bob = await newPlayer(browser);
  const url = await createRoom(alice.page, "Alice");
  await joinRoom(bob.page, url, "Bob");
  const [a, b] = [alice.page, bob.page];

  await a.getByRole("button", { name: /^Luffarschack/ }).click();
  await a.getByRole("button", { name: "Small 15×15" }).click();
  await a.getByRole("button", { name: "Start Luffarschack" }).click();
  await a.getByTestId("lfs-sit").click();
  await expect(a.getByText("Waiting for an opponent")).toBeVisible();
  await b.getByTestId("lfs-sit").click();

  // Alice draws the crosses and starts; Bob's clicks do nothing.
  await expect(a.getByTestId("lfs-status")).toHaveText("Your move.");
  await expect(b.getByTestId("lfs-status")).toHaveText("Alice to move…");
  await expect(a.locator(".lfs-coords text")).toHaveCount(30);
  const g7 = await squareAt(b, "G7");
  await b.mouse.click(g7.x, g7.y);
  await expect(b.locator("[data-piece]")).toHaveCount(0);

  await mark(a, "C5");
  await expect(b.getByTestId("lfs-mark-C5")).toHaveAttribute("data-piece", "x");
  await expect(b.getByTestId("lfs-last")).toContainText("Alice drew a cross on C5.");
  await mark(b, "C6");
  await expect(a.getByTestId("lfs-mark-C6")).toHaveAttribute("data-piece", "o");
  await mark(a, "D5");

  // Bob plays from the keyboard: the cursor starts on the last mark (D5); down one and Enter marks D6.
  await expect(b.getByTestId("lfs-status")).toHaveText("Your move.");
  await b.getByTestId("lfs-sheet").focus();
  await b.keyboard.press("ArrowDown");
  await b.keyboard.press("Enter");
  await expect(a.getByTestId("lfs-mark-D6")).toHaveAttribute("data-piece", "o");

  // A marked square can't be marked again.
  await expect(a.getByTestId("lfs-status")).toHaveText("Your move.");
  const c6 = await squareAt(a, "C6");
  await a.mouse.click(c6.x, c6.y);
  await expect(a.locator("[data-piece]")).toHaveCount(4);

  await mark(a, "E5");
  await mark(b, "E6");
  await mark(a, "F5");
  await mark(b, "F6");
  // Alice makes five across row 5: she rings it, and the results follow.
  await mark(a, "G5");
  await expect(a.getByTestId("lfs-status")).toHaveText("You win with five in a row.");
  await expect(b.getByTestId("lfs-status")).toHaveText("Alice wins with five in a row.");
  await expect(a.getByTestId("lfs-loop")).toHaveCount(1);
  await expect(a.getByTestId("lfs-result")).toContainText("You win!");
  await expect(b.getByTestId("lfs-result")).toContainText("Alice wins!");
  await expect(b.getByTestId("lfs-result")).toContainText("Five in a row (C5–G5)");

  // Bob draws the first cross of the next game, on a clean sheet.
  await b.getByTestId("lfs-result").getByRole("button", { name: "Play again (you start)" }).click();
  await expect(b.getByTestId("lfs-status")).toHaveText("Your move.");
  await expect(a.getByTestId("lfs-status")).toHaveText("Bob to move…");
  await expect(a.locator("[data-piece]")).toHaveCount(0);
  await mark(b, "H8");
  await expect(a.getByTestId("lfs-mark-H8")).toHaveAttribute("data-piece", "x");

  // Resigning asks first.
  await a.getByTestId("lfs-resign").click();
  await a.getByTestId("lfs-resign-yes").click();
  await expect(b.getByTestId("lfs-status")).toHaveText("You win (Alice resigned).");
});

test("Luffarschack on a phone: the first tap pencils a square in, the second inks it, nothing covers the sheet", async ({ browser }) => {
  const context = await browser.newContext({ ...devices["Pixel 7"], extraHTTPHeaders: { "CF-Connecting-IP": `10.31.${Math.floor(Math.random() * 250)}.7` } });
  const page = await context.newPage();
  await page.goto("/try/luffarschack/opening");
  const status = page.getByTestId("lfs-status");
  await expect(status).toHaveText(/^Your move: tap a square/, { timeout: 20_000 });
  const at = await squareAt(page, "C3");
  await page.touchscreen.tap(at.x, at.y);
  await expect(status).toHaveText("C3 is pencilled in: tap it again to ink it.");
  await expect(page.getByTestId("lfs-confirm").getByRole("button", { name: "Mark C3" })).toBeVisible();
  // Nothing over the sheet: the confirm sits below it.
  const sheet = (await page.getByTestId("lfs-sheet").boundingBox())!;
  expect((await page.getByTestId("lfs-confirm").boundingBox())!.y).toBeGreaterThan(sheet.y + sheet.height);
  await page.touchscreen.tap(at.x, at.y);
  await expect(page.getByTestId("lfs-confirm")).toHaveCount(0);
  await expect(page.getByTestId("lfs-last")).toContainText("on C3");
  await context.close();
});

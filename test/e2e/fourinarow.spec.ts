import { expect, type Page, test } from "@playwright/test";
import { createRoom, joinRoom, newPlayer } from "./helpers";

/** Once it's their move, drop a disc into `column` (1 is the left). */
async function drop(page: Page, column: number) {
  await expect(page.getByTestId("fiar-status")).toHaveText("Your move.");
  await page.getByTestId(`fiar-col-${column}`).click();
}

test("Four in a Row: sit, drop by click and keyboard, four in a row, play again", async ({ browser }) => {
  const alice = await newPlayer(browser);
  const bob = await newPlayer(browser);
  const url = await createRoom(alice.page, "Alice");
  await joinRoom(bob.page, url, "Bob");
  const [a, b] = [alice.page, bob.page];

  await a.getByRole("button", { name: /^Four in a Row/ }).click();
  await a.getByRole("button", { name: "Quick 1+2" }).click();
  await a.getByRole("button", { name: "Start Four in a Row" }).click();
  await a.getByTestId("fiar-sit").click();
  await expect(a.getByText("Waiting for an opponent")).toBeVisible();
  await b.getByTestId("fiar-sit").click();

  // Alice starts; Bob's columns can't be clicked.
  await expect(a.getByTestId("fiar-status")).toHaveText("Your move.");
  await expect(a.getByTestId("fiar-clock-o")).toHaveText("1:00");
  await expect(b.getByTestId("fiar-status")).toHaveText("Alice to move…");
  await expect(b.getByTestId("fiar-col-4")).toBeDisabled();

  // A disc falls to the bottom; the next one in that column lands on it.
  await drop(a, 1);
  await expect(b.getByTestId("fiar-disc-1-1")).toHaveAttribute("data-piece", "x");
  await expect(b.getByTestId("fiar-last")).toHaveText("Alice dropped a disc in column 1.");
  await drop(b, 1);
  await expect(a.getByTestId("fiar-disc-1-2")).toHaveAttribute("data-piece", "o");
  await drop(a, 2);

  // Bob plays from the keyboard: Home, then right, then Enter drops into column 2; a digit drops straight in.
  await expect(b.getByTestId("fiar-status")).toHaveText("Your move.");
  await b.getByTestId("fiar-board").focus();
  await b.keyboard.press("Home");
  await b.keyboard.press("ArrowRight");
  await b.keyboard.press("Enter");
  await expect(a.getByTestId("fiar-disc-2-2")).toHaveAttribute("data-piece", "o");
  await drop(a, 3);
  await expect(b.getByTestId("fiar-status")).toHaveText("Your move.");
  await b.getByTestId("fiar-board").focus();
  await b.keyboard.press("3");
  await expect(a.getByTestId("fiar-disc-3-2")).toHaveAttribute("data-piece", "o");
  for (const p of [a, b]) await expect(p.getByTestId("fiar-moves")).toContainText("3");

  // Alice completes the bottom row: the line is drawn and the results follow.
  await drop(a, 4);
  await expect(a.getByTestId("fiar-status")).toHaveText("You win with four in a row.");
  await expect(b.getByTestId("fiar-status")).toHaveText("Alice wins with four in a row.");
  await expect(a.locator(".fiar-line line")).toHaveCount(1);
  await expect(a.locator(".fiar-disc.won")).toHaveCount(4);
  await expect(a.getByTestId("fiar-result")).toContainText("You win!");
  await expect(b.getByTestId("fiar-result")).toContainText("Alice wins!");

  // Taking turns: Bob starts the next game, on an empty board.
  await b.getByTestId("fiar-result").getByRole("button", { name: "Play again (you start)" }).click();
  await expect(b.getByTestId("fiar-status")).toHaveText("Your move.");
  await expect(a.getByTestId("fiar-status")).toHaveText("Bob to move…");
  await expect(a.locator("[data-piece]")).toHaveCount(0);
  await drop(b, 4);
  await expect(a.getByTestId("fiar-disc-4-1")).toHaveAttribute("data-piece", "x");

  // Resigning asks first.
  await a.getByTestId("fiar-resign").click();
  await a.getByTestId("fiar-resign-yes").click();
  await expect(b.getByTestId("fiar-status")).toHaveText("You win (Alice resigned).");
});

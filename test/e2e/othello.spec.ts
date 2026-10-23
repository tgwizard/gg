import { expect, type Page, test } from "@playwright/test";
import { createRoom, joinRoom, newPlayer } from "./helpers";

/** Once it's their move, put a disc on `square`. */
async function play(page: Page, square: string) {
  await expect(page.getByTestId("othello-status")).toHaveText("Your move.");
  await page.getByTestId(`othello-sq-${square}`).click();
}

test("Othello: sit, play and flip, resign, then swap colors", async ({ browser }) => {
  const alice = await newPlayer(browser);
  const bob = await newPlayer(browser);
  const url = await createRoom(alice.page, "Alice");
  await joinRoom(bob.page, url, "Bob");
  const [a, b] = [alice.page, bob.page];

  await a.getByRole("button", { name: /^Othello/ }).click();
  await a.getByRole("button", { name: "Quick 3+2" }).click();
  await a.getByRole("button", { name: "Start Othello" }).click();
  await a.getByTestId("othello-sit").click();
  await expect(a.getByText("Waiting for an opponent")).toBeVisible();
  await b.getByTestId("othello-sit").click();

  // Alice has Black and moves first; her four openings are marked, and Bob can't play.
  await expect(a.getByTestId("othello-status")).toHaveText("Your move.");
  await expect(a.getByTestId("othello-clock-w")).toHaveText("3:00");
  await expect(a.locator(".oth-sq.legal")).toHaveCount(4);
  await expect(b.locator(".oth-sq.legal")).toHaveCount(0);
  await expect(b.getByTestId("othello-status")).toHaveText("Black to move (Alice)…");

  // f5 traps e5.
  await play(a, "f5");
  await expect(b.getByTestId("othello-disc-e5")).toHaveAttribute("data-color", "b");
  await expect(b.getByTestId("othello-last")).toHaveText("Alice played f5 and turned over 1 disc.");
  await play(b, "f6");
  await expect(a.getByTestId("othello-disc-e5")).toHaveAttribute("data-color", "w");
  await play(a, "e6");
  for (const p of [a, b]) {
    await expect(p.getByTestId("othello-count-b")).toContainText("5");
    await expect(p.getByTestId("othello-count-w")).toContainText("2");
    await expect(p.getByTestId("othello-moves")).toContainText("e6");
  }
  await expect(a.getByTestId("othello-last")).toHaveText("You played e6 and turned over 1 disc.");

  // Resigning asks first.
  await b.getByTestId("othello-resign").click();
  await b.getByTestId("othello-resign-yes").click();
  await expect(a.getByTestId("othello-status")).toHaveText("You win (Bob resigned).");
  await expect(a.getByTestId("othello-result")).toContainText("You win!");
  await expect(b.getByTestId("othello-result")).toContainText("Alice wins!");

  // The next game swaps colors: Bob opens as Black, on a fresh board.
  await b.getByTestId("othello-result").getByRole("button", { name: /Play again/ }).click();
  await expect(b.getByTestId("othello-status")).toHaveText("Your move.");
  await expect(a.getByTestId("othello-status")).toHaveText("Black to move (Bob)…");
  await expect(a.getByTestId("othello-count-b")).toContainText("2");
  await play(b, "d3");
  await expect(a.getByTestId("othello-disc-d4")).toHaveAttribute("data-color", "b");
});

import { expect, test } from "@playwright/test";
import { chat, newPlayer } from "./helpers";

test("/try sets up a practice room in a game's last move, with a bot", async ({ browser }) => {
  const { page } = await newPlayer(browser);
  await page.goto("/");
  await page.getByRole("link", { name: "Try a game in a set-up position" }).click();
  await page.getByRole("link", { name: /Win in one/ }).click();
  await page.waitForURL(/\/r\/[0-9A-Z]{10}$/);
  await expect(page.getByTestId("practice-tag")).toBeVisible();
  await expect(page.getByTestId("member")).toHaveCount(2);
  await expect(chat(page)).toContainText("You set up Tic-tac-toe: Win in one.");
  await expect(page.getByTestId("room-name")).toHaveText("Win in one");
  // X on the first two squares and it's your move: the last square of the top row wins.
  await expect(page.getByTestId("ttt-cell-1")).toHaveAccessibleName("X in square 2");
  await page.getByTestId("ttt-cell-2").click();
  await expect(chat(page)).toContainText("Round 1: You wins as X.");
});

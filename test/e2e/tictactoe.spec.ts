import { expect, test } from "@playwright/test";
import { chat, createRoom, joinRoom, newPlayer } from "./helpers";

test("two players play a round of tic-tac-toe", async ({ browser }) => {
  const alice = await newPlayer(browser);
  const bob = await newPlayer(browser);
  const url = await createRoom(alice.page, "Alice");
  await joinRoom(bob.page, url, "Bob");

  await alice.page.getByRole("button", { name: /Tic-tac-toe/ }).click();
  await alice.page.getByRole("button", { name: "Start tic-tac-toe" }).click();
  await alice.page.getByRole("button", { name: "Play as X" }).click();
  await bob.page.getByRole("button", { name: "Play as O" }).click();
  await expect(alice.page.getByTestId("ttt-status")).toHaveText("Your move (X)");

  const move = async (page: typeof alice.page, cell: number) => {
    await page.getByTestId(`ttt-cell-${cell}`).click();
    await expect(page.getByTestId(`ttt-cell-${cell}`)).not.toHaveText("");
  };
  await move(alice.page, 0);
  await move(bob.page, 3);
  await move(alice.page, 1);
  await move(bob.page, 4);
  await move(alice.page, 2);

  for (const p of [alice.page, bob.page]) {
    await expect(p.getByTestId("ttt-status")).toContainText("Alice wins!");
    await expect(p.getByTestId("ttt-seat-0")).toContainText("1 wins");
    await expect(chat(p)).toContainText("Round 1: Alice wins as X.");
  }
  // Next round starts on its own, with O opening.
  await expect(bob.page.getByTestId("ttt-status")).toHaveText("Your move (O)", { timeout: 8_000 });
});

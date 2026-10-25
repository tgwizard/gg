import { expect, type Page, test } from "@playwright/test";
import { createRoom, newPlayer } from "./helpers";

/** Once it's the move of whoever the game is shown as, drop a disc into `column`. */
async function drop(page: Page, column: number) {
  await expect(page.getByTestId("fiar-status")).toHaveText("Your move.");
  await page.getByTestId(`fiar-col-${column}`).click();
}

test("hot seat: two people take turns on one device, the game shown as whoever's to move", async ({ browser }) => {
  const { page: a } = await newPlayer(browser);
  await createRoom(a, "Alice");

  // Someone here with Alice joins the room on her device.
  await a.getByTestId("invite-section").getByRole("button", { name: "+ Player on this device" }).click();
  await a.getByLabel("Player's name").fill("Sam");
  await a.getByRole("button", { name: "Add", exact: true }).click();
  const sam = a.getByRole("complementary").getByTestId("member").filter({ hasText: "Sam" });
  await expect(sam).toContainText("with you");

  // Games where nothing is hidden say so.
  const card = a.getByRole("button", { name: /^Four in a Row/ });
  await expect(card.getByTestId("tag-hot-seat")).toHaveText("Hot seat");
  await card.click();
  await a.getByRole("button", { name: "Start Four in a Row" }).click();

  // Alice sits down, then switches to Sam to sit him down too.
  const bar = a.getByTestId("hot-seat");
  await expect(bar.getByRole("button", { name: /Alice/ })).toHaveAttribute("aria-pressed", "true");
  await a.getByTestId("fiar-sit").click();
  await bar.getByRole("button", { name: /Sam/ }).click();
  await expect(a.getByText("Take on Alice")).toBeVisible();
  await a.getByTestId("fiar-sit").click();

  // Alice opens; after each move the game turns to the other one of them.
  await expect(bar.getByRole("button", { name: /Alice/ })).toHaveAttribute("aria-pressed", "true");
  await expect(a.getByTestId("turn-pill")).toHaveText("Your turn");
  for (let i = 0; i < 3; i++) {
    await drop(a, 1);
    await expect(bar.getByRole("button", { name: /Sam/ })).toHaveAttribute("aria-pressed", "true");
    await expect(a.getByTestId("turn-pill")).toHaveText("Sam's turn");
    await expect(a.getByTestId("fiar-side-o")).toContainText("you");
    await drop(a, 2);
    await expect(bar.getByRole("button", { name: /Alice/ })).toHaveAttribute("aria-pressed", "true");
  }
  await drop(a, 1);
  await expect(a.getByTestId("fiar-result")).toContainText("You win!");

  // Taken out of the room, Sam leaves it (and stays on this device for next time).
  await sam.getByRole("button", { name: "Remove Sam" }).click();
  await expect(sam).toHaveCount(0);
  await expect(a.getByTestId("hot-seat")).toHaveCount(0);
});

import { expect, type Page, test } from "@playwright/test";
import { createRoom, joinRoom, newPlayer } from "./helpers";

const myCards = (page: Page) => page.locator(".fish-hand [data-card]").evaluateAll((els) => els.map((e) => e.getAttribute("data-card")!));

test("Finns i sjön: deal, keep hands private, and play a turn", async ({ browser }) => {
  const alice = await newPlayer(browser);
  const bob = await newPlayer(browser);
  const url = await createRoom(alice.page, "Alice");
  await joinRoom(bob.page, url, "Bob");

  await alice.page.getByRole("button", { name: /Finns i sjön/ }).click();
  await alice.page.getByRole("button", { name: "Open the table" }).click();
  await alice.page.getByTestId("fish-seat-0").getByRole("button", { name: "Sit here" }).click();
  await bob.page.getByTestId("fish-seat-1").getByRole("button", { name: "Sit here" }).click();
  await alice.page.getByRole("button", { name: "Deal" }).click();

  // Two players: 7 cards each (fewer if a four was dealt and laid down), 38 in the lake.
  await expect(alice.page.getByTestId("fish-lake")).toContainText("Sjön · 38 cards");
  const aliceCards = await myCards(alice.page);
  const bobCards = await myCards(bob.page);
  expect(aliceCards.length).toBeGreaterThan(0);
  for (const c of bobCards) await expect(alice.page.locator(`[data-card="${c}"]`)).toHaveCount(0);
  for (const c of aliceCards) await expect(bob.page.locator(`[data-card="${c}"]`)).toHaveCount(0);

  // Whoever's turn it is asks for the rank of their first card (one opponent, so it's preselected).
  const pages = [alice.page, bob.page];
  const asker = (await alice.page.getByRole("button", { name: /^Ask / }).isVisible()) ? alice.page : bob.page;
  const other = pages.find((p) => p !== asker)!;
  await asker.locator(".fish-card").first().click();
  const ask = asker.getByRole("button", { name: /^Ask (Alice|Bob) for / });
  await expect(ask).toBeEnabled();
  await ask.click();
  for (const p of pages) await expect(p.getByTestId("fish-news")).toContainText(/asked (Alice|Bob|you) for/);
  // Both see the same public story from their own side.
  await expect(other.getByTestId("fish-news")).toContainText(/asked you for/);
});

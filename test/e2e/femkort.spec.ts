import { expect, type Page, test } from "@playwright/test";
import { createRoom, joinRoom, newPlayer } from "./helpers";

const myCards = (page: Page) => page.locator(".fem-hand button[data-card]").evaluateAll((els) => els.map((e) => e.getAttribute("data-card")!));
const playableCards = (page: Page) => page.locator(".fem-hand button[data-playable]").evaluateAll((els) => els.map((e) => e.getAttribute("data-card")!));

test("Fem kort: deal, keep hands private, follow suit, and take tricks", async ({ browser }) => {
  const alice = await newPlayer(browser);
  const bob = await newPlayer(browser);
  const url = await createRoom(alice.page, "Alice");
  await joinRoom(bob.page, url, "Bob");
  const [a, b] = [alice.page, bob.page];

  await a.getByRole("button", { name: /^Fem kort/ }).click();
  await a.getByRole("button", { name: "Open the table" }).click();
  await a.getByTestId("fem-seat-0").getByRole("button", { name: "Sit here" }).click();
  await b.getByTestId("fem-seat-1").getByRole("button", { name: "Sit here" }).click();
  await a.getByRole("button", { name: "Deal" }).click();

  // Five cards each, and neither sees the other's.
  await expect(a.locator(".fem-hand button[data-card]")).toHaveCount(5);
  await expect(b.locator(".fem-hand button[data-card]")).toHaveCount(5);
  const aliceCards = await myCards(a);
  const bobCards = await myCards(b);
  for (const c of bobCards) await expect(a.locator(`[data-card="${c}"]`)).toHaveCount(0);
  for (const c of aliceCards) await expect(b.locator(`[data-card="${c}"]`)).toHaveCount(0);
  for (const p of [a, b]) await expect(p.getByTestId("fem-news")).toContainText(/Deal 1\./);

  // Whoever leads may play anything; the other then sees what they must follow.
  const leader = (await a.locator(".fem-hint.your-turn").isVisible()) ? a : b;
  const other = leader === a ? b : a;
  await expect(leader.getByTestId("fem-hint")).toContainText("Your lead");
  await expect(other.getByTestId("fem-hint")).toContainText(/Waiting for (Alice|Bob)/);
  expect(await playableCards(leader)).toHaveLength(5);
  const lead = (await playableCards(leader))[0]!;
  await leader.locator(`.fem-hand button[data-card="${lead}"]`).click();
  for (const p of [a, b]) await expect(p.getByTestId("fem-led")).toBeVisible();
  await expect(other.locator(`[data-testid^="fem-played-"] [data-card="${lead}"]`)).toBeVisible();

  // The follower may only play cards of the suit led (beating it if they can), or anything if they have none.
  await expect(other.locator(".fem-hint.your-turn")).toBeVisible();
  const hand = await myCards(other);
  const allowed = await playableCards(other);
  const suited = hand.filter((c) => c[1] === lead[1]);
  if (suited.length) {
    expect(allowed.every((c) => c[1] === lead[1])).toBe(true);
    await expect(other.getByTestId("fem-hint")).toContainText("Follow");
  } else {
    expect(allowed).toHaveLength(hand.length);
    await expect(other.getByTestId("fem-hint")).toContainText("play any card");
  }
  await other.locator(`.fem-hand button[data-card="${allowed[0]}"]`).click();

  // The trick goes to someone, who leads the next one; both see the same story.
  for (const p of [a, b]) await expect(p.getByTestId("fem-news")).toContainText(/took trick 1 with/);
  for (const p of [a, b]) await expect(p.locator(".fem-hand button[data-card]")).toHaveCount(4);
});

test("Fem kort: the last trick wins the game (from /try)", async ({ browser }) => {
  const { page } = await newPlayer(browser);
  await page.goto("/try/femkort/last-trick");
  await expect(page.getByTestId("fem-last-trick")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("fem-hint")).toContainText("Last trick!");
  await expect(page.getByTestId("fem-hint")).toContainText("beat the 7♠");
  await page.locator('.fem-hand button[data-card="Ks"]').click();
  await expect(page.getByTestId("fem-result")).toContainText("You win!", { timeout: 15_000 });
  await expect(page.getByTestId("fem-result")).toContainText("First to 3 deals, the last taken with the K♠.");
  await expect(page.getByTestId("fem-result").getByRole("button", { name: "Play again" })).toBeVisible();
});

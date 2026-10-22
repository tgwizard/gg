import { expect, test } from "@playwright/test";
import { chat, createRoom, expectConnected, joinRoom, myCards, newPlayer, openPokerTable, playOutHand, sit } from "./helpers";

test("two players play a hand of hold'em while a spectator watches", async ({ browser }) => {
  const alice = await newPlayer(browser);
  const bob = await newPlayer(browser);
  const carol = await newPlayer(browser);
  const url = await createRoom(alice.page, "Alice");
  await joinRoom(bob.page, url, "Bob");
  await joinRoom(carol.page, url, "Carol");

  await openPokerTable(alice.page);
  await expect(bob.page.getByTestId("poker-table")).toBeVisible();
  await sit(alice.page, 0);
  await sit(bob.page, 4);
  await bob.page.getByRole("button", { name: "Deal" }).click();

  // Everyone sees only their own hole cards; the spectator sees none.
  await expect(alice.page.locator(".seat.me [data-card]")).toHaveCount(2);
  await expect(bob.page.locator(".seat.me [data-card]")).toHaveCount(2);
  const aliceCards = await myCards(alice.page);
  const bobCards = await myCards(bob.page);
  for (const c of bobCards) await expect(alice.page.locator(`[data-card="${c}"]`)).toHaveCount(0);
  for (const c of aliceCards) await expect(bob.page.locator(`[data-card="${c}"]`)).toHaveCount(0);
  await expect(carol.page.locator(".seat [data-card]")).toHaveCount(0);
  await expect(carol.page.locator(".seat .pcard.back")).toHaveCount(4);

  await playOutHand([alice.page, bob.page]);
  for (const p of [alice.page, bob.page, carol.page]) {
    await expect(p.getByTestId("hand-result")).toContainText(/wins|split/);
    await expect(chat(p)).toContainText(/Hand #1: .* (wins|split)/);
  }
  // Checked down to showdown, so both hands are now public.
  await expect(carol.page.locator(".seat [data-card]")).toHaveCount(4);

  // The next hand deals itself.
  await expect(alice.page.locator(".seat.me [data-card]")).toHaveCount(2, { timeout: 12_000 });
  await expect(alice.page.getByTestId("hand-result")).toBeHidden();
});

test("refreshing mid-hand puts you back in your seat with your cards", async ({ browser }) => {
  const alice = await newPlayer(browser);
  const bob = await newPlayer(browser);
  const url = await createRoom(alice.page, "Alice");
  await joinRoom(bob.page, url, "Bob");
  await openPokerTable(alice.page);
  await sit(alice.page, 2);
  await sit(bob.page, 6);
  await alice.page.getByRole("button", { name: "Deal" }).click();
  await expect(alice.page.locator(".seat.me [data-card]")).toHaveCount(2);
  const before = await myCards(alice.page);

  await alice.page.reload();
  await expectConnected(alice.page);
  await expect(alice.page.locator(".seat.me")).toHaveAttribute("data-testid", "seat-2");
  expect(await myCards(alice.page)).toEqual(before);
});

test("the turn timer folds an idle player and sits them out", async ({ browser }) => {
  const alice = await newPlayer(browser);
  const bob = await newPlayer(browser);
  const url = await createRoom(alice.page, "Alice");
  await joinRoom(bob.page, url, "Bob");
  await openPokerTable(alice.page, { turnSeconds: 2 });
  await sit(alice.page, 0);
  await sit(bob.page, 1);
  await alice.page.getByRole("button", { name: "Deal" }).click();

  // Nobody acts: whoever is first to act times out.
  await expect(alice.page.getByTestId("hand-result")).toBeVisible({ timeout: 8_000 });
  const backButtons = [alice.page, bob.page].map((p) => p.getByRole("button", { name: "I'm back" }));
  await expect(async () => {
    const visible = await Promise.all(backButtons.map((b) => b.isVisible()));
    expect(visible.filter(Boolean)).toHaveLength(1); // exactly the player who timed out
  }).toPass();
  // Coming back resumes dealing.
  for (const b of backButtons) if (await b.isVisible()) await b.click();
  await expect(alice.page.getByTestId("hand-result")).toBeHidden({ timeout: 8_000 });
});

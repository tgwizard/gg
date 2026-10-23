import { expect, type Page, test } from "@playwright/test";
import { createRoom, joinRoom, newPlayer } from "./helpers";

/** The tickets offered to a player, as shown to them. */
const offers = (page: Page) => page.getByTestId("ttr-offer").allTextContents();

test("Ticket to Ride: choose tickets in private, draw cards and claim a route", async ({ browser }) => {
  const alice = await newPlayer(browser);
  const bob = await newPlayer(browser);
  const url = await createRoom(alice.page, "Alice");
  await joinRoom(bob.page, url, "Bob");
  const pages = [alice.page, bob.page];

  await alice.page.getByRole("button", { name: /Ticket to Ride/ }).click();
  await alice.page.getByRole("button", { name: "Open the table" }).click();
  await alice.page.getByTestId("ttr-seat-0").getByRole("button", { name: "Sit here" }).click();
  await bob.page.getByTestId("ttr-seat-1").getByRole("button", { name: "Sit here" }).click();
  await alice.page.getByTestId("ttr-start").click();

  // Everyone chooses their first tickets at once; nobody sees anyone else's.
  for (const p of pages) await expect(p.getByTestId("ttr-offer")).toHaveCount(3);
  const aliceOffers = await offers(alice.page);
  for (const t of aliceOffers) await expect(bob.page.getByText(t.replace(/\d+$/, ""), { exact: false })).toHaveCount(0);
  for (const p of pages) {
    await expect(p.getByTestId("ttr-keep")).toBeDisabled();
    await p.getByTestId("ttr-offer").nth(0).click();
    await p.getByTestId("ttr-offer").nth(2).click();
    await p.getByTestId("ttr-keep").click();
  }
  for (const p of pages) await expect(p.getByTestId("ttr-tickets")).toContainText("0 of 2 done");

  // Whoever goes first draws two cards blind: they get 2 more, and the other sees only that.
  for (const p of pages) await expect(p.getByTestId("ttr-news")).toContainText(/(Bob|You) drew 3 tickets and kept 2/);
  await expect(alice.page.getByTestId("ttr-market")).toBeVisible();
  const first = (await alice.page.getByTestId("ttr-deck").isEnabled()) ? alice.page : bob.page;
  const second = pages.find((p) => p !== first)!;
  await expect(second.getByTestId("ttr-deck")).toBeDisabled();
  await first.getByTestId("ttr-deck").click();
  await expect(first.getByTestId("ttr-hint")).toContainText("one more card");
  await first.getByTestId("ttr-deck").click();
  for (const p of pages) await expect(p.getByTestId("ttr-news")).toContainText(/(You|Alice|Bob) took\s*both from the deck/);
  // Blind draws are card backs to the other player, and the real cards to the one who drew them.
  await expect(second.getByTestId("ttr-news").locator(".ttr-card.back")).toHaveCount(2);
  await expect(first.getByTestId("ttr-news").locator(".ttr-card.back")).toHaveCount(0);
  await expect(first.getByTestId("ttr-hand")).toContainText("From the deck last turn");
  await expect(second.getByTestId("ttr-hand")).not.toContainText("From the deck last turn");

  // The second player keeps drawing until a route can be claimed, then claims it.
  await expect(second.getByTestId("ttr-deck")).toBeEnabled();
  for (let turn = 0; (await second.getByTestId("ttr-claimable").count()) === 0; turn++) {
    expect(turn).toBeLessThan(15);
    for (const p of [second, first]) {
      await expect(p.getByTestId("ttr-deck")).toBeEnabled();
      await p.getByTestId("ttr-deck").click();
      await expect(p.getByTestId("ttr-hint")).toContainText("one more card");
      await p.getByTestId("ttr-deck").click();
    }
    await expect(second.getByTestId("ttr-deck")).toBeEnabled();
  }
  const route = second.getByTestId("ttr-claimable").first();
  const id = (await route.getAttribute("data-route"))!;
  await route.dispatchEvent("click");
  await expect(second.getByTestId("ttr-claim")).toBeVisible();
  await second.getByTestId("ttr-pay").first().click();
  for (const p of pages) {
    await expect(p.getByTestId("ttr-news")).toContainText(/claimed/);
    await expect(p.locator(`[data-route="${id}"]`)).toHaveClass(/claimed/);
  }
});

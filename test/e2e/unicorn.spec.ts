import { expect, test } from "@playwright/test";
import { chat, createRoom, joinRoom, newPlayer } from "./helpers";

test("Unicorn race: sit down as a kid or a grown-up, roll, and gallop round the meadow", async ({ browser }) => {
  const alice = await newPlayer(browser);
  const bob = await newPlayer(browser);
  const url = await createRoom(alice.page, "Alice");
  await joinRoom(bob.page, url, "Bob");

  await alice.page.getByRole("button", { name: /Unicorn race/ }).click();
  await alice.page.getByRole("button", { name: "Rarely" }).click();
  await alice.page.getByRole("button", { name: "Open the meadow" }).click();
  await alice.page.getByTestId("uni-seat-0").getByRole("button", { name: "As a kid" }).click();
  await bob.page.getByTestId("uni-seat-1").getByRole("button", { name: "As a grown-up" }).click();
  await expect(alice.page.getByTestId("uni-seat-0")).toContainText("kid");
  await expect(alice.page.getByTestId("uni-seat-1")).toContainText("grown-up");
  // Changed her mind: Alice can switch before the race.
  await alice.page.getByTestId("uni-seat-0").getByRole("button", { name: "Grown-up" }).click();
  await expect(alice.page.getByTestId("uni-seat-0")).toContainText("grown-up");
  await alice.page.getByTestId("uni-seat-0").getByRole("button", { name: "Kid" }).click();
  await expect(alice.page.getByTestId("uni-seat-0")).toContainText("kid");

  await alice.page.getByRole("button", { name: "Start the race" }).click();
  await expect(chat(bob.page)).toContainText("Alice started Unicorn race.");
  // The kid goes first: her die is ready to tap; Bob's tells him whose turn it is.
  const die = (p: typeof alice.page) => p.getByTestId("uni-die");
  await expect(die(alice.page)).not.toHaveAttribute("aria-disabled");
  await expect(die(bob.page)).toHaveAttribute("aria-disabled", "true");
  await expect(bob.page.getByTestId("uni-turn")).toContainText("Alice's turn");
  await die(bob.page).click({ force: true });
  await expect(bob.page.getByRole("status").filter({ hasText: "It's Alice's turn to roll." })).toBeVisible();

  await die(alice.page).click();
  await expect(die(alice.page)).toHaveAttribute("data-value", /[1-6]/);
  const value = Number(await die(alice.page).getAttribute("data-value"));
  // Both see her unicorn hop to that stop, and a bubble there says what she found.
  for (const p of [alice.page, bob.page]) {
    await expect(p.getByTestId("uni-token").filter({ has: p.locator("title", { hasText: "Alice" }) })).toHaveAttribute("data-stop", String(value));
    await expect(p.getByTestId("uni-bubble")).toBeVisible();
  }
  // Whoever's at her stop wants a ride: she picks them up herself, and they ride along round her unicorn.
  const choice = alice.page.getByRole("group", { name: "Who wants a ride?" });
  if (await choice.isVisible()) {
    const friend = (await choice.getByRole("button").first().getAttribute("aria-label"))!.replace("Pick up the ", "").toLowerCase();
    await choice.getByRole("button").first().click();
    for (const p of [alice.page, bob.page]) {
      await expect(p.getByTestId("uni-token").filter({ has: p.locator("title", { hasText: "Alice" }) }).locator(`[data-testid="uni-friend"][data-rider="${friend}"]`)).toHaveCount(1);
      await expect(p.getByTestId("uni-bubble")).toContainText("hops on!");
      await expect(p.getByTestId("uni-seat-0").getByTestId("uni-ring")).toHaveAttribute("data-count", "1");
    }
  }
  await expect(die(bob.page)).not.toHaveAttribute("aria-disabled");
  await expect(alice.page.getByTestId("uni-turn")).toContainText("Bob's turn");
});

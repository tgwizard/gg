import { expect, test } from "@playwright/test";
import { createRoom, joinRoom, newPlayer } from "./helpers";

test("Cannons: sit, aim with the keys, fire and watch, then the other side gives up", async ({ browser }) => {
  const alice = await newPlayer(browser);
  const bob = await newPlayer(browser);
  const url = await createRoom(alice.page, "Alice");
  await joinRoom(bob.page, url, "Bob");
  const [a, b] = [alice.page, bob.page];

  await a.getByRole("button", { name: /^Cannons/ }).click();
  await a.getByRole("button", { name: "No wind" }).click();
  await a.getByRole("button", { name: "Start Cannons" }).click();
  await a.getByTestId("cannons-sit").click();
  await expect(a.getByText("Waiting for an opponent")).toBeVisible();
  await b.getByTestId("cannons-sit").click();

  // Seat 0 fires first: Alice has the controls, Bob watches her aim.
  await expect(a.getByTestId("cannons-fire")).toBeVisible();
  await expect(b.getByTestId("cannons-status")).toHaveText(/Alice is aiming/);
  await expect(a.getByTestId("cannons-wind")).toHaveText("No wind");
  await expect(a.getByTestId("cannons-power")).toHaveText("60");
  // Down to 30 (a shot to the middle of the field, well short of Bob), then 35.
  for (let i = 0; i < 6; i++) await a.keyboard.press("Shift+ArrowDown");
  await expect(a.getByTestId("cannons-power")).toHaveText("30");
  await a.keyboard.press("ArrowUp");
  await a.keyboard.press("Shift+ArrowUp");
  await a.keyboard.press("ArrowDown");
  await expect(a.getByTestId("cannons-power")).toHaveText("35");
  const angle = await a.getByTestId("cannons-angle").textContent();
  await a.keyboard.press("ArrowLeft");
  await expect(a.getByTestId("cannons-angle")).not.toHaveText(angle!);
  await a.getByTestId("cannons-fire").click();

  // Both watch it fly; when it's down, the news says where it went and it's Bob's turn.
  await expect(b.getByTestId("cannons-news")).toContainText("Alice fires");
  await expect(b.getByTestId("cannons-news")).toContainText(/Alice's shot (landed|went|hit)/, { timeout: 15_000 });
  await expect(a.getByTestId("cannons-news")).toContainText(/Your shot (landed|went|hit)/);
  await expect(b.getByTestId("cannons-fire")).toBeVisible({ timeout: 10_000 });
  await expect(a.getByTestId("cannons-status")).toHaveText(/Bob is aiming/);
  await expect(a.getByTestId("cannons-trace")).toHaveCount(1);

  // A refresh shows the field as it is: the trail of the shot, and nothing flying.
  await a.reload();
  await expect(a.getByTestId("cannons-trace")).toHaveCount(1);
  await expect(a.getByTestId("cannons-news")).toContainText(/Your shot/);

  // Bob gives up: Alice is the last cannon standing.
  await b.getByRole("button", { name: "Give up & leave" }).click();
  await expect(a.getByTestId("cannons-result")).toContainText("You win!");
  await expect(a.getByTestId("cannons-result")).toContainText("the other player left");
});

test("Cannons: a won game from /try, and Play again on a new field", async ({ browser }) => {
  const { page } = await newPlayer(browser);
  await page.goto("/try/cannons/game-over");
  await expect(page.getByTestId("cannons-result")).toContainText("You win!", { timeout: 20_000 });
  await expect(page.getByTestId("cannons-result")).toContainText("by you");
  await page.getByTestId("cannons-result").getByRole("button", { name: "Play again" }).click();
  // The bot opens the next game; then it's your shot.
  await expect(page.getByTestId("cannons-news")).toContainText(/fires first|'s shot/);
  await expect(page.getByTestId("cannons-fire")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("cannons-cannon-0")).toHaveAttribute("data-alive", "true");
});

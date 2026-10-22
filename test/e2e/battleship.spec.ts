import { expect, type Page, test } from "@playwright/test";
import { chat, createRoom, joinRoom, newPlayer } from "./helpers";

/** Bob's fleet, placed by hand: every ship along the left edge on even rows, so its cells are known. */
const BOWS = [0, 20, 40, 60, 80];
const SIZES = [5, 4, 3, 3, 2];
const BOB_CELLS = BOWS.flatMap((bow, i) => Array.from({ length: SIZES[i]! }, (_, k) => bow + k));

const shipsOn = (page: Page, side: number) => page.getByTestId(`bs-board-${side}`).locator(".bs-ship");

async function fire(page: Page, side: number, cell: number) {
  const target = page.getByTestId(`bs-cell-${side}-${cell}`);
  await target.click();
  await expect(target).toHaveAttribute("data-shot", /hit|miss/);
}

test("two players hide fleets, trade shots and finish a game of Battleship", async ({ browser }) => {
  const alice = await newPlayer(browser);
  const bob = await newPlayer(browser);
  const url = await createRoom(alice.page, "Alice");
  await joinRoom(bob.page, url, "Bob");

  await alice.page.getByRole("button", { name: /Battleship/ }).click();
  await alice.page.getByRole("button", { name: "Start Battleship" }).click();
  await alice.page.getByRole("button", { name: "Take a seat" }).click();
  await bob.page.getByRole("button", { name: "Take a seat" }).click();

  // Bob places by hand: the next unplaced ship goes wherever he clicks.
  await expect(bob.page.getByTestId("bs-dock")).toBeVisible();
  for (const [i, bow] of BOWS.entries()) {
    await bob.page.getByTestId(`bs-cell-1-${bow}`).click();
    await expect(shipsOn(bob.page, 1)).toHaveCount(i + 1);
  }
  await expect(bob.page.getByTestId("bs-plate-0")).toContainText("placing");
  await bob.page.getByRole("button", { name: "Ready" }).click();
  await expect(alice.page.getByTestId("bs-plate-1")).toContainText("ready");
  // Alice sees that Bob is ready, and nothing of where his ships are.
  await expect(shipsOn(alice.page, 1)).toHaveCount(0);

  await alice.page.getByRole("button", { name: "Random" }).click();
  await expect(shipsOn(alice.page, 0)).toHaveCount(5);
  await alice.page.getByRole("button", { name: "Ready" }).click();
  await expect(alice.page.getByTestId("bs-status")).toHaveText("Your shot: pick a cell in Bob's waters.");
  await expect(shipsOn(bob.page, 0)).toHaveCount(0);

  const aliceCells = new Set(
    await shipsOn(alice.page, 0).evaluateAll((els) => els.flatMap((e) => e.getAttribute("data-cells")!.split(" ").map(Number))),
  );
  const bobTargets = Array.from({ length: 100 }, (_, i) => i).filter((c) => !aliceCells.has(c));

  for (const [i, cell] of BOB_CELLS.entries()) {
    await fire(alice.page, 1, cell);
    if (i === 0) {
      await expect(alice.page.getByTestId("bs-news")).toContainText("You fired at A1: hit!");
      await expect(bob.page.getByTestId("bs-news")).toContainText("Alice hit your Carrier at A1!");
      await expect(shipsOn(alice.page, 1)).toHaveCount(0); // a hit doesn't show the ship
    }
    if (i === 4) {
      await expect(alice.page.getByTestId("bs-news")).toContainText("You sank Bob's Carrier!");
      await expect(shipsOn(alice.page, 1)).toHaveCount(1); // only the sunk one
    }
    if (i === BOB_CELLS.length - 1) break;
    await fire(bob.page, 0, bobTargets[i]!);
  }

  for (const p of [alice.page, bob.page]) {
    await expect(p.getByTestId("bs-result")).toContainText("sank");
    await expect(p.getByTestId("bs-plate-0")).toContainText("1 win");
    await expect(chat(p)).toContainText("Battleship game 1: Alice sank Bob's whole fleet in 17 shots!");
    // Both fleets are revealed at the end.
    await expect(shipsOn(p, 0)).toHaveCount(5);
    await expect(shipsOn(p, 1)).toHaveCount(5);
  }
  await expect(alice.page.getByTestId("bs-result")).toContainText("You win!");

  // Rematch: back to placing, with Bob shooting first this time.
  await bob.page.getByRole("button", { name: "Play again" }).click();
  for (const p of [alice.page, bob.page]) await expect(p.getByTestId("bs-dock")).toBeVisible();
  for (const p of [alice.page, bob.page]) {
    await p.getByRole("button", { name: "Random" }).click();
    await expect(shipsOn(p, p === alice.page ? 0 : 1)).toHaveCount(5);
    await p.getByRole("button", { name: "Ready" }).click();
  }
  await expect(bob.page.getByTestId("bs-status")).toHaveText("Your shot: pick a cell in Alice's waters.");
});

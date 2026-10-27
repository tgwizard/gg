import { expect, type Page, test } from "@playwright/test";
import { createRoom, joinRoom, newPlayer } from "./helpers";

/** Once it's their move, click a piece, then where it goes. */
async function move(page: Page, from: string, to: string) {
  await expect(page.getByTestId("chess-status")).toContainText("Your move");
  await page.getByTestId(`chess-sq-${from}`).click();
  await page.getByTestId(`chess-sq-${to}`).click();
}

test("Chess: sit, move by clicking and dragging, mate, then swap colors and resign", async ({ browser }) => {
  const alice = await newPlayer(browser);
  const bob = await newPlayer(browser);
  const url = await createRoom(alice.page, "Alice");
  await joinRoom(bob.page, url, "Bob");
  const [a, b] = [alice.page, bob.page];

  await a.getByRole("button", { name: /^Chess/ }).click();
  await a.getByRole("button", { name: "Blitz 3+2" }).click();
  await a.getByRole("button", { name: "Start chess" }).click();
  await a.getByTestId("chess-sit").click();
  await expect(a.getByText("Waiting for an opponent")).toBeVisible();
  await b.getByTestId("chess-sit").click();

  // Alice has White and both clocks show 3 minutes; Black's board is turned around.
  await expect(a.getByTestId("chess-status")).toHaveText("Your move.");
  await expect(a.getByTestId("chess-clock-b")).toHaveText("3:00");
  const top = async (p: Page) => (await p.getByTestId("chess-sq-a8").boundingBox())!.y < (await p.getByTestId("chess-sq-a1").boundingBox())!.y;
  expect(await top(a)).toBe(true);
  expect(await top(b)).toBe(false);

  // Picking up a piece marks where it can go.
  await a.getByTestId("chess-sq-g1").click();
  await expect(a.locator(".chess-sq.target")).toHaveCount(2);
  await a.getByTestId("chess-sq-g1").click();
  await expect(a.locator(".chess-sq.target")).toHaveCount(0);
  // Out of turn, Bob can't touch Alice's pieces, but can queue up a premove of his own.
  await b.getByTestId("chess-sq-e2").click();
  await expect(b.locator(".chess-sq.target")).toHaveCount(0);
  await b.getByTestId("chess-sq-d7").click();
  await b.getByTestId("chess-sq-d5").click();
  await expect(b.getByTestId("chess-premove")).toContainText("pawn d7 → d5");
  await b.getByTestId("chess-sq-d4").click(); // an empty square calls it off
  await expect(b.getByTestId("chess-premove")).toHaveCount(0);
  await b.getByTestId("chess-sq-c7").click();
  await b.getByTestId("chess-sq-c5").click();
  await expect(b.getByTestId("chess-premove")).toContainText("pawn c7 → c5");
  await b.keyboard.press("Escape"); // so does Escape
  await expect(b.getByTestId("chess-premove")).toHaveCount(0);
  await b.getByTestId("chess-sq-e7").click();
  await b.getByTestId("chess-sq-e5").click();
  await expect(b.locator(".chess-sq.premove")).toHaveCount(2);
  await expect(b.getByTestId("chess-premove-piece")).toHaveCount(1);
  await expect(b.getByTestId("chess-piece-e7")).toBeVisible();

  // Drag a pawn two squares.
  const [from, to] = [await a.getByTestId("chess-sq-e2").boundingBox(), await a.getByTestId("chess-sq-e4").boundingBox()];
  await expect(a.getByTestId("chess-status")).toHaveText("Your move.");
  await a.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await a.mouse.down();
  await a.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 6 });
  await a.mouse.up();
  await expect(b.getByTestId("chess-piece-e4")).toBeVisible();
  await expect(b.getByTestId("chess-moves")).toContainText("e4");
  // Bob's premove is played the moment Alice has moved.
  await expect(a.getByTestId("chess-piece-e5")).toBeVisible();
  await expect(b.getByTestId("chess-premove")).toHaveCount(0);

  // Scholar's mate.
  await move(a, "f1", "c4");
  await move(b, "b8", "c6");
  await move(a, "d1", "h5");
  await move(b, "g8", "f6");
  await move(a, "h5", "f7");
  for (const p of [a, b]) await expect(p.getByTestId("chess-moves")).toContainText("Qxf7#");
  await expect(a.getByTestId("chess-status")).toHaveText("You win by checkmate.");
  await expect(b.getByTestId("chess-status")).toHaveText("Alice wins by checkmate.");
  await expect(b.getByTestId("chess-side-w")).toContainText("+1");
  // What happened, in words.
  await expect(a.getByTestId("chess-last")).toHaveText("Your queen took Bob's pawn on f7. Checkmate!");
  await expect(b.getByTestId("chess-last")).toHaveText("Alice's queen took your pawn on f7. Checkmate!");
  await expect(a.locator(".chess-sq.check")).toHaveCount(1);

  // The next game swaps colors: Bob opens.
  await b.getByTestId("chess-result").getByRole("button", { name: /Play again/ }).click();
  await expect(b.getByTestId("chess-status")).toHaveText("Your move.");
  await expect(a.getByTestId("chess-status")).toContainText("White to move (Bob)");
  expect(await top(a)).toBe(false);

  // Castle by putting the king on the rook.
  await move(b, "g1", "f3");
  await move(a, "a7", "a6");
  await move(b, "e2", "e3");
  await move(a, "a6", "a5");
  await move(b, "f1", "e2");
  await move(a, "a5", "a4");
  // Picking up the king says how to castle (or why not), and marks the rook.
  await b.getByTestId("chess-sq-e1").click();
  await expect(b.getByTestId("chess-castling")).toContainText("Kingside: put your king on g1, or on the rook on h1.");
  await expect(b.getByTestId("chess-castling")).toContainText("Queenside: Clear b1, c1 and d1 first");
  await expect(b.getByTestId("chess-sq-h1").locator(".chess-castle-tag")).toBeVisible();
  // Pointing at the rook shows where the two end up.
  await b.getByTestId("chess-sq-h1").hover();
  await expect(b.getByTestId("chess-castle-preview")).toHaveCount(2);
  await b.getByTestId("chess-sq-h1").click();
  await expect(a.getByTestId("chess-last")).toHaveText("Bob castled kingside.");
  await expect(a.getByTestId("chess-moves")).toContainText("O-O");
  await expect(a.getByTestId("chess-piece-g1")).toBeVisible();
  await expect(a.getByTestId("chess-piece-f1")).toBeVisible();

  // Resigning asks first.
  await a.getByTestId("chess-resign").click();
  await a.getByTestId("chess-resign-yes").click();
  await expect(b.getByTestId("chess-status")).toHaveText("You win (Alice resigned).");
});

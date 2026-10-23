import { expect, type Page, test } from "@playwright/test";
import { createRoom, joinRoom, newPlayer } from "./helpers";

/** Once it's their move, put a stone on `point`. */
async function play(page: Page, point: string) {
  await expect(page.getByTestId("go-status")).toHaveText("Your move.");
  await page.getByTestId(`go-pt-${point}`).click();
}

async function pass(page: Page) {
  await expect(page.getByTestId("go-status")).toHaveText("Your move.");
  await page.getByTestId("go-pass").click();
}

test("Go: capture, pass into counting, mark, resume, accept, then swap colors", async ({ browser }) => {
  const alice = await newPlayer(browser);
  const bob = await newPlayer(browser);
  const url = await createRoom(alice.page, "Alice");
  await joinRoom(bob.page, url, "Bob");
  const [a, b] = [alice.page, bob.page];

  await a.getByRole("button", { name: /^Go/ }).click();
  await a.getByRole("button", { name: "9×9" }).click();
  await a.getByRole("button", { name: "Quick 2 min + 3×10s" }).click();
  await a.getByRole("button", { name: "Start Go" }).click();
  await a.getByTestId("go-sit").click();
  await expect(a.getByText("Waiting for an opponent")).toBeVisible();
  await b.getByTestId("go-sit").click();

  // Alice has Black and moves first.
  await expect(a.getByTestId("go-status")).toHaveText("Your move.");
  await expect(a.getByTestId("go-clock-w")).toContainText("2:00");
  await expect(b.getByTestId("go-status")).toHaveText("Black to move (Alice)…");

  // Black surrounds White's E6 and takes it.
  for (const [p, point] of [[a, "E5"], [b, "E6"], [a, "D6"], [b, "A1"], [a, "F6"], [b, "A2"]] as const) await play(p, point);
  await play(a, "E7");
  await expect(b.getByTestId("go-stone-E6")).toHaveCount(0);
  await expect(b.getByTestId("go-last")).toHaveText("Alice played E7 and captured 1 stone.");
  await expect(b.getByTestId("go-captures-b")).toContainText("1");

  // Two passes: counting.
  await pass(b);
  await expect(a.getByTestId("go-last")).toContainText("Bob passed.");
  await expect(a.getByTestId("go-pass")).toHaveText("Pass & count");
  await pass(a);
  for (const p of [a, b]) await expect(p.getByTestId("go-score")).toBeVisible();

  // Clicking a group marks it dead, or alive again.
  const stone = b.getByTestId("go-stone-A1");
  const wasDead = /dead/.test((await stone.getAttribute("class")) ?? "");
  await b.getByTestId("go-pt-A1").click();
  await expect(a.getByTestId("go-stone-A1")).toHaveClass(wasDead ? /^(?!.*dead)/ : /dead/);

  // Bob resumes: Alice (the other side) moves first; then two passes again.
  await b.getByTestId("go-resume").click();
  await play(a, "C3");
  await pass(b);
  await pass(a);
  await a.getByTestId("go-accept").click();
  await expect(a.getByTestId("go-accepted")).toContainText("Waiting for Bob");
  await b.getByTestId("go-accept").click();
  await expect(a.getByTestId("go-result")).toContainText(/wins by/);
  await expect(b.getByTestId("go-status")).toContainText(/wins? by .* points?\./);

  // The next game swaps colors: Bob opens as Black, on an empty board.
  await b.getByTestId("go-result").getByRole("button", { name: /Play again/ }).click();
  await expect(b.getByTestId("go-status")).toHaveText("Your move.");
  await expect(a.getByTestId("go-status")).toHaveText("Black to move (Bob)…");
  await play(b, "C7");
  await expect(a.getByTestId("go-stone-C7")).toHaveAttribute("data-color", "b");
});

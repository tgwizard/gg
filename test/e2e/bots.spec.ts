import { expect, type Page, test } from "@playwright/test";
import { chat, createRoom, expectConnected, newPlayer } from "./helpers";

/** Add a bot, keeping its suggested name and color unless given a name. */
async function addBot(page: Page, rename?: string): Promise<string> {
  await page.getByRole("complementary").getByRole("button", { name: "+ Add a bot" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a bot" });
  if (rename) await dialog.getByLabel("Bot's name").fill(rename);
  const name = await dialog.getByLabel("Bot's name").inputValue();
  expect(name).not.toBe("");
  await dialog.getByRole("button", { name: "Add bot" }).click();
  await expect(chat(page)).toContainText(`added a bot, ${name}.`);
  const member = page.getByTestId("member").filter({ hasText: name });
  await expect(member.getByRole("button", { name: `Remove ${name}` })).toBeVisible();
  await expect(member).toHaveClass(/online/);
  return name;
}

test("play tic-tac-toe against a built-in bot, then remove it", async ({ browser }) => {
  const alice = await newPlayer(browser);
  const page = alice.page;
  await createRoom(page, "Alice");
  let bot = await addBot(page, "Robo");

  await page.getByRole("button", { name: /Tic-tac-toe/ }).click();
  await page.getByRole("button", { name: "Start tic-tac-toe" }).click();
  // Alice sits down; the bot follows her to the table right away.
  await page.getByRole("button", { name: /Play as X$/ }).click();
  await expect(page.getByTestId("ttt-seat-1")).toContainText(bot, { timeout: 4_000 });
  // On the board, the bot has a robot for an avatar; Alice has her initial.
  const plates = page.locator(".plate");
  await expect(plates.filter({ hasText: bot }).locator(".avatar[data-bot]")).toBeVisible();
  await expect(plates.filter({ hasText: "Alice" }).locator(".avatar[data-bot]")).toHaveCount(0);

  // Rename and recolor it mid-game.
  await page.getByRole("button", { name: `Edit ${bot}` }).click();
  const edit = page.getByRole("dialog", { name: `Edit ${bot}` });
  await edit.getByLabel("Bot's name").fill("Clank");
  await edit.getByRole("radio", { name: /^Teal/ }).click();
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(chat(page)).toContainText("Robo is now known as Clank.");
  bot = "Clank";
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("gg.bots")!)[0])).toMatchObject({ name: "Clank", color: 7 });
  await expect(plates.filter({ hasText: bot })).toBeVisible();

  // Alice plays the first free square whenever it's her move, until the round ends.
  const status = page.getByTestId("ttt-status");
  for (let i = 0; i < 40 && !(await chat(page).getByText(/Round 1: /).isVisible()); i++) {
    if (/^Your move/.test((await status.textContent()) ?? "")) {
      for (let cell = 0; cell < 9; cell++) {
        const square = page.getByTestId(`ttt-cell-${cell}`);
        if ((await square.textContent()) === "" && (await square.isEnabled())) {
          await square.click();
          break;
        }
      }
    }
    await page.waitForTimeout(300);
  }
  await expect(chat(page)).toContainText(/Round 1: (a draw|(Alice|\w+) wins as [XO])/);

  // A reload brings the bot back with you.
  await page.reload();
  await expectConnected(page);
  await expect(page.getByTestId("member").filter({ hasText: bot })).toHaveClass(/online/);

  await page.getByRole("button", { name: `Remove ${bot}` }).click();
  await expect(chat(page)).toContainText(`Alice removed ${bot}.`);
  await expect(page.getByTestId("member").filter({ hasText: bot })).toHaveCount(0);
  // Its seat is free again.
  await expect(page.getByText("Open seat")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("gg.bots"))).toBe("[]");
});

test("bots leave seats to people for a while before sitting down themselves", async ({ browser }) => {
  const alice = await newPlayer(browser);
  const page = alice.page;
  await createRoom(page, "Alice");
  const one = await addBot(page);
  const two = await addBot(page);
  await page.getByRole("button", { name: /Tic-tac-toe/ }).click();
  await page.getByRole("button", { name: "Start tic-tac-toe" }).click();
  const started = Date.now();
  await page.waitForTimeout(5_000);
  await expect(page.getByRole("button", { name: /Play as [XO]$/ })).toHaveCount(2);
  // After about 10 seconds with nobody seated, they take both seats and play each other.
  await expect(page.getByText("Open seat")).toHaveCount(0, { timeout: 10_000 });
  expect(Date.now() - started).toBeGreaterThan(9_000);
  for (const name of [one, two]) await expect(page.locator(".plate").filter({ hasText: name })).toBeVisible();
});

test("a bot plays from one tab at a time, and another tab takes over when it closes", async ({ browser }) => {
  const alice = await newPlayer(browser);
  const url = await createRoom(alice.page, "Alice");
  const bot = await addBot(alice.page);

  const second = await alice.context.newPage();
  await second.goto(url);
  await expectConnected(second);
  const member = (page: Page) => page.getByTestId("member").filter({ hasText: bot });
  await expect(member(second)).toHaveClass(/online/);
  await expect(member(second)).toHaveCount(1);

  await alice.page.close();
  // The bot drops for a moment, then the second tab picks it up.
  await expect(member(second)).toHaveClass(/online/, { timeout: 15_000 });
  await second.waitForTimeout(500);
  await expect(member(second)).toHaveClass(/online/);
  await second.getByRole("button", { name: `Remove ${bot}` }).click();
  await expect(member(second)).toHaveCount(0);
});

test("settings are a click away from the bot and profile popups, with a way back to the room", async ({ browser }) => {
  const { page } = await newPlayer(browser);
  const url = await createRoom(page, "Alice");

  await page.getByRole("complementary").getByRole("button", { name: "+ Add a bot" }).click();
  await page.getByRole("dialog", { name: "Add a bot" }).getByRole("link", { name: "Configure AI settings" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await page.getByRole("link", { name: "← Back to the room" }).click();
  await expect(page).toHaveURL(url);
  await expectConnected(page);

  await page.getByRole("button", { name: "Alice" }).click();
  await page.getByRole("dialog", { name: "Your profile" }).getByRole("link", { name: "All settings" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("link", { name: "← Back to the room" })).toBeVisible();
});

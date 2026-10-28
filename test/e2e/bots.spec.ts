import { expect, type Page, test } from "@playwright/test";
import { chat, createRoom, expectConnected, joinRoom, newPlayer } from "./helpers";

/** Add a bot, keeping its suggested name and color unless given a name. */
async function addBot(page: Page, rename?: string): Promise<string> {
  await page.getByRole("complementary").getByRole("button", { name: "+ Invite a bot" }).click();
  const dialog = page.getByRole("dialog", { name: "Invite a bot" });
  // With bots of yours already, the list comes first; make a new one.
  await expect(dialog.getByLabel("Bot's name").or(dialog.getByRole("button", { name: "+ New bot" }))).toBeVisible();
  if (await dialog.getByRole("button", { name: "+ New bot" }).isVisible()) await dialog.getByRole("button", { name: "+ New bot" }).click();
  if (rename) await dialog.getByLabel("Bot's name").fill(rename);
  const name = await dialog.getByLabel("Bot's name").inputValue();
  expect(name).not.toBe("");
  await dialog.getByRole("button", { name: "Make and invite" }).click();
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

  // Rename, recolor and toughen it mid-game (new bots play easy).
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("gg.bots")!)[0])).toMatchObject({ level: "builtin", strength: "easy" });
  await page.getByRole("button", { name: `Edit ${bot}` }).click();
  const edit = page.getByRole("dialog", { name: `Edit ${bot}` });
  await expect(edit.getByLabel("Plays")).toHaveValue("easy");
  await edit.getByLabel("Bot's name").fill("Clank");
  await edit.getByRole("radio", { name: /^Teal/ }).click();
  await edit.getByLabel("Plays").selectOption("hard");
  await expect(edit).toContainText("Built-in bot · hard · no AI");
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(chat(page)).toContainText("Robo is now known as Clank.");
  bot = "Clank";
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("gg.bots")!)[0])).toMatchObject({ name: "Clank", color: 7, strength: "hard" });
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
  // Out of the room, but still yours.
  const kept = JSON.parse((await page.evaluate(() => localStorage.getItem("gg.bots"))) ?? "[]") as { name: string; rooms: object }[];
  expect(kept.map((b) => [b.name, b.rooms])).toEqual([["Clank", {}]]);
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
  await member(second).getByRole("button", { name: `Remove ${bot}` }).click();
  await expect(member(second)).toHaveCount(0);
});

test("settings are a click away from the bot and profile popups, with a way back to the room", async ({ browser }) => {
  const { page } = await newPlayer(browser);
  const url = await createRoom(page, "Alice");

  await page.getByRole("complementary").getByRole("button", { name: "+ Invite a bot" }).click();
  await page.getByRole("dialog", { name: "Invite a bot" }).getByRole("link", { name: "Add an AI key" }).click();
  await expect(page).toHaveURL(/\/settings#bots$/);
  await expect(page.getByRole("tab", { name: "Bots & AI" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("link", { name: "← Back to the room" }).click();
  await expect(page).toHaveURL(url);
  await expectConnected(page);

  await page.getByRole("button", { name: "Alice" }).click();
  await page.getByRole("dialog", { name: "Your profile" }).getByRole("link", { name: "All settings" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("link", { name: "← Back to the room" })).toBeVisible();
});

test("bots are yours across rooms: invite one into another room, edit it everywhere, delete it from settings", async ({ browser }) => {
  const alice = await newPlayer(browser);
  const first = await createRoom(alice.page, "Alice");
  const bot = await addBot(alice.page, "Marvin");

  // A second room: Marvin is one click away, and the same player as in the first.
  await alice.page.goto("/");
  await alice.page.getByRole("button", { name: "Create a room" }).click();
  await alice.page.waitForURL(/\/r\/[0-9A-Z]{10}$/);
  await expectConnected(alice.page);
  await alice.page.getByRole("complementary").getByRole("button", { name: "+ Invite a bot" }).click();
  await alice.page.getByRole("dialog", { name: "Invite a bot" }).getByRole("button", { name: `Invite ${bot}` }).click();
  const member = alice.page.getByTestId("member").filter({ hasText: bot });
  await expect(member).toHaveClass(/online/);

  // Edited from the lobby's "Here now": the change shows up in the room.
  await alice.page.getByTestId("invite-section").getByRole("button", { name: `Edit ${bot}` }).click();
  const edit = alice.page.getByRole("dialog", { name: `Edit ${bot}` });
  await edit.getByLabel("Personality").fill("Depressed, but polite.");
  await edit.getByRole("button", { name: "Save" }).click();

  // Someone else sees what it is (its personality too).
  const bea = await newPlayer(browser);
  await joinRoom(bea.page, alice.page.url(), "Bea");
  await bea.page.getByRole("complementary").getByRole("button", { name: `About ${bot}` }).click();
  await expect(bea.page.getByRole("dialog", { name: `About ${bot}` })).toContainText("Depressed, but polite.");

  // Deleted in settings: it leaves both rooms, even the one nobody has open.
  await alice.page.goto("/settings#bots");
  const card = alice.page.getByTestId("bot-card").filter({ hasText: bot });
  await expect(card).toContainText("in 2 rooms");
  await card.getByRole("button", { name: `Delete ${bot}` }).click();
  await card.getByRole("button", { name: `Delete ${bot}`, exact: true }).last().click();
  await expect(alice.page.getByTestId("bot-card")).toHaveCount(0);
  await expect(bea.page.getByTestId("member").filter({ hasText: bot })).toHaveCount(0);
  await expect(chat(bea.page)).toContainText(`Alice removed ${bot}.`);
  await expect.poll(() => alice.page.evaluate(() => localStorage.getItem("gg.bots"))).toBe("[]");
  await alice.page.goto(first);
  await expectConnected(alice.page);
  await expect(alice.page.getByTestId("member").filter({ hasText: bot })).toHaveCount(0);
});

test("your bots can be taken out from the invite panel too, not only the sidebar", async ({ browser }) => {
  const { page } = await newPlayer(browser);
  await createRoom(page, "Alice");
  const bot = await addBot(page, "Robo");
  const invite = page.getByTestId("invite-section");
  await invite.getByRole("button", { name: `Remove ${bot}` }).click();
  await expect(chat(page)).toContainText(`Alice removed ${bot}.`);
  await expect(invite.getByText(bot)).toHaveCount(0);
  await expect(page.getByTestId("member").filter({ hasText: bot })).toHaveCount(0);
});

test("a bot on its way in shows as joining, or says why it can't come in, and comes in once it can", async ({ browser }) => {
  const { page } = await newPlayer(browser);
  await createRoom(page, "Alice");
  // The rules bots play by fail to download (a dropped request, or a deploy since the page loaded).
  let broken = true;
  await page.route(/games\/registry/, (r) => (broken ? r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html>" }) : r.continue()));
  await page.getByRole("complementary").getByRole("button", { name: "+ Invite a bot" }).click();
  const dialog = page.getByRole("dialog", { name: "Invite a bot" });
  const name = await dialog.getByLabel("Bot's name").inputValue();
  await dialog.getByRole("button", { name: "Make and invite" }).click();

  const joining = page.getByTestId("invite-section").getByTestId("bot-joining");
  await expect(joining).toContainText(name);
  await joining.getByRole("button", { name: "can't join" }).click();
  await expect(page.getByRole("dialog", { name: `Why ${name} isn't here` })).toContainText("Couldn't load what bots need to play");
  await page.keyboard.press("Escape");

  // It keeps trying, and comes in once the download works.
  broken = false;
  await expect(joining).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByTestId("member").filter({ hasText: name })).toHaveClass(/online/);
  await expect(chat(page)).toContainText(`added a bot, ${name}.`);
});

test("a bot whose connection doesn't get through shows as joining", async ({ browser }) => {
  const { page } = await newPlayer(browser);
  await createRoom(page, "Alice");
  await page.routeWebSocket(/\/api\/rooms\/[^/]+\/ws$/, (ws) => {
    const server = ws.connectToServer();
    let bot = false;
    ws.onMessage((m) => {
      if (typeof m === "string" && m.includes('"owner"')) bot = true;
      if (!bot) server.send(m);
    });
    server.onMessage((m) => !bot && ws.send(m));
  });
  await page.reload();
  await expectConnected(page);
  await page.getByRole("complementary").getByRole("button", { name: "+ Invite a bot" }).click();
  const dialog = page.getByRole("dialog", { name: "Invite a bot" });
  const name = await dialog.getByLabel("Bot's name").inputValue();
  await dialog.getByRole("button", { name: "Make and invite" }).click();
  const joining = page.getByTestId("invite-section").getByTestId("bot-joining");
  await expect(joining).toContainText(name);
  await expect(joining).toContainText("joining…");
  // In the room's list too, with a × to call it off.
  const listed = page.getByRole("complementary").getByTestId("bot-joining");
  await expect(listed).toContainText("joining…");
  await listed.getByRole("button", { name: `Remove ${name}` }).click();
  await expect(joining).toHaveCount(0);
});

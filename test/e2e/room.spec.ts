import { expect, test } from "@playwright/test";
import { chat, createRoom, expectConnected, joinRoom, newPlayer, sendChat } from "./helpers";

test("create a room, invite someone, chat both ways", async ({ browser }) => {
  const alice = await newPlayer(browser);
  const bob = await newPlayer(browser);
  const url = await createRoom(alice.page, "Alice");
  await joinRoom(bob.page, url, "Bob");

  for (const p of [alice.page, bob.page]) {
    await expect(p.getByTestId("member")).toHaveCount(2);
    await expect(chat(p)).toContainText("Bob joined the room.");
  }

  await sendChat(alice.page, "hi bob");
  await expect(chat(bob.page)).toContainText("hi bob");
  await sendChat(bob.page, "hey alice");
  await expect(chat(alice.page)).toContainText("hey alice");
});

test("name is remembered across rooms and renames propagate", async ({ browser }) => {
  const alice = await newPlayer(browser);
  const bob = await newPlayer(browser);
  const url = await createRoom(alice.page, "Alice");
  await joinRoom(bob.page, url, "Bob");

  await bob.page.getByRole("button", { name: /Bob/ }).click();
  await bob.page.getByLabel("Your name").fill("Robert");
  await bob.page.getByRole("button", { name: "Save" }).click();
  await expect(chat(alice.page)).toContainText("Bob is now known as Robert.");
  await expect(alice.page.getByTestId("member").filter({ hasText: "Robert" })).toBeVisible();

  // A second room: no name prompt, the saved name is used.
  const url2 = await createRoom(alice.page, "Alice");
  await bob.page.goto(url2);
  await expectConnected(bob.page);
  await expect(alice.page.getByTestId("member").filter({ hasText: "Robert" })).toBeVisible();
});

test("refreshing keeps your identity and the chat history", async ({ browser }) => {
  const alice = await newPlayer(browser);
  const bob = await newPlayer(browser);
  const url = await createRoom(alice.page, "Alice");
  await joinRoom(bob.page, url, "Bob");
  await sendChat(bob.page, "before refresh");
  await expect(chat(alice.page)).toContainText("before refresh");

  await bob.page.reload();
  await expectConnected(bob.page);
  await expect(chat(bob.page)).toContainText("before refresh");
  // Same player, not a new member.
  await expect(alice.page.getByTestId("member")).toHaveCount(2);
  await expect(chat(alice.page).getByText("joined the room")).toHaveCount(2);
});

test("unknown rooms show a friendly error", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("gg.name", "Ghost"));
  await page.goto(`/r/${crypto.randomUUID()}`);
  await expect(page.getByRole("heading", { name: "Room not found" })).toBeVisible();
});

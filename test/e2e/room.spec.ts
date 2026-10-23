import { expect, test } from "@playwright/test";
import { generateRoomCode } from "../../src/shared/roomCode";
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
  await page.goto(`/r/${generateRoomCode()}`);
  await expect(page.getByRole("heading", { name: "Room not found" })).toBeVisible();
});

test("joining by typing the room code, in any case", async ({ browser }) => {
  const alice = await newPlayer(browser);
  const bob = await newPlayer(browser);
  const url = await createRoom(alice.page, "Alice");
  const code = url.split("/r/")[1]!;
  await expect(alice.page.getByTestId("room-code")).toHaveText(code);

  await bob.page.goto("/");
  await bob.page.getByLabel("Your name").fill("Bob");
  const input = bob.page.getByLabel("Room code or link");
  await input.fill(`${code.slice(0, 5).toLowerCase()} ${code.slice(5).toLowerCase()}`);
  await expect(input).toHaveValue(`${code.slice(0, 5)} ${code.slice(5)}`);
  await bob.page.getByRole("button", { name: "Join" }).click();
  await expectConnected(bob.page);
  await expect(bob.page).toHaveURL(new RegExp(`/r/${code}$`));
  await expect(alice.page.getByTestId("member")).toHaveCount(2);

  // A lower-cased link works too, and is shown canonically.
  await bob.page.goto(`/r/${code.toLowerCase()}`);
  await expectConnected(bob.page);
  await expect(bob.page).toHaveURL(new RegExp(`/r/${code}$`));
});

test("profile colors resolve clashes, and rooms can be named and renamed", async ({ browser }) => {
  const alice = await newPlayer(browser);
  const bob = await newPlayer(browser);

  // Alice picks Sky on the home page and names her room.
  await alice.page.goto("/");
  await alice.page.getByLabel("Your name").fill("Alice");
  await alice.page.getByRole("radio", { name: "Sky" }).click();
  await alice.page.getByLabel(/Room name/).fill("Friday poker");
  await alice.page.getByRole("button", { name: "Create a room" }).click();
  await alice.page.waitForURL(/\/r\//);
  await expectConnected(alice.page);
  await expect(alice.page.getByTestId("room-name")).toHaveText("Friday poker");

  // Bob wants Sky too; he joined second, so he gets the next free color.
  await bob.page.goto(alice.page.url());
  await bob.page.getByLabel("Your name").fill("Bob");
  await bob.page.getByRole("radio", { name: "Sky" }).click();
  await bob.page.getByRole("button", { name: "Join room" }).click();
  await expectConnected(bob.page);
  await expect(bob.page.getByText("Sky is taken here, so you're Teal in this room.")).toBeVisible();

  // Anyone can rename the room.
  await bob.page.getByTestId("room-name").click();
  await bob.page.getByLabel("Room name").fill("Taco night");
  await bob.page.getByLabel("Room name").press("Enter");
  await expect(alice.page.getByTestId("room-name")).toHaveText("Taco night");
  await expect(chat(alice.page)).toContainText("Bob named the room “Taco night”.");
});

test("the chat sidebar folds away and counts what's new", async ({ browser }) => {
  const alice = await newPlayer(browser);
  const bob = await newPlayer(browser);
  const url = await createRoom(alice.page, "Alice");
  await joinRoom(bob.page, url, "Bob");

  await alice.page.getByRole("button", { name: "Hide chat" }).click();
  const rail = alice.page.getByTestId("sidebar-rail");
  await expect(rail).toBeVisible();
  await expect(alice.page.getByLabel("Chat message")).toHaveCount(0);
  await sendChat(bob.page, "are you there?");
  await expect(rail.getByRole("button", { name: "Show chat (1 new)" })).toBeVisible();

  // Remembered across a reload; showing it again brings the message.
  await alice.page.reload();
  await expectConnected(alice.page);
  await alice.page.getByTestId("sidebar-rail").getByRole("button", { name: /Show chat/ }).click();
  await expect(chat(alice.page)).toContainText("are you there?");
});

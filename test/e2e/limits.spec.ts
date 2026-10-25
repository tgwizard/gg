import { expect, test } from "@playwright/test";
import { chat, createRoom, expectConnected, joinRoom, newPlayer, sendChat } from "./helpers";

test("creating too many rooms explains itself", async ({ browser }) => {
  const { page } = await newPlayer(browser);
  await page.goto("/");
  // Use up the allowance quickly (10 a minute per IP).
  const statuses = await page.evaluate(async () => {
    const out: number[] = [];
    for (let i = 0; i < 10; i++) out.push((await fetch("/api/rooms", { method: "POST" })).status);
    return out;
  });
  expect(statuses.every((s) => s === 201)).toBe(true);

  await page.getByLabel("Your name").fill("Eager");
  await page.getByRole("button", { name: "Create a room" }).click();
  await expect(page.getByText(/made a lot of rooms in the last minute/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Create a room" })).toBeEnabled();
});

test("being told to back off shows why, then reconnects on its own", async ({ browser }) => {
  const alice = await newPlayer(browser);
  const bob = await newPlayer(browser);
  const routes: import("@playwright/test").WebSocketRoute[] = [];
  await alice.page.routeWebSocket(/\/api\/rooms\/[^/]+\/ws$/, (ws) => {
    ws.connectToServer();
    routes.push(ws);
  });
  const url = await createRoom(alice.page, "Alice");
  await joinRoom(bob.page, url, "Bob");

  // What the server does when a network makes too many connection attempts.
  const ws = routes.at(-1)!;
  ws.send(JSON.stringify({ type: "error", code: "rate_limited", message: "Too many connection attempts from your network.", retryAfterMs: 3000 }));
  await ws.close({ code: 4429, reason: "rate_limited" });

  const banner = alice.page.getByRole("alert");
  await expect(banner).toContainText("Too many connection attempts from your network.");
  await expect(banner).toContainText(/Retrying in \ds/);
  await expect(banner.getByRole("button", { name: "Retry now" })).toHaveCount(0);
  // Chat typed meanwhile is kept and delivered.
  await sendChat(alice.page, "patience");
  await expectConnected(alice.page, 10_000);
  await expect(banner).toBeHidden();
  await expect(chat(bob.page)).toContainText("patience");
});

test("chatting fast is paced rather than refused; far ahead, it's refused gently, without losing the message", async ({ browser }) => {
  const alice = await newPlayer(browser);
  const bob = await newPlayer(browser);
  const url = await createRoom(alice.page, "Alice");
  await joinRoom(bob.page, url, "Bob");
  const input = alice.page.getByLabel("Chat message");
  // Offline, so nothing goes out meanwhile: 30 wait, and the 31st is handed back.
  await alice.context.setOffline(true);
  for (let i = 0; i < 31; i++) {
    await input.fill(`msg ${i}`);
    await input.press("Enter");
  }
  await expect(alice.page.getByTestId("toast").first()).toContainText(/still waiting to be sent/);
  await expect(input).toHaveValue("msg 30");
  await expect(alice.page.getByTestId("chat-pending")).toHaveCount(30);
  // Back online, the first ten go at once and the rest at the pace the server takes.
  await alice.context.setOffline(false);
  await expect(chat(bob.page)).toContainText("msg 9", { timeout: 15_000 });
  await expect(chat(bob.page)).toContainText("msg 12", { timeout: 10_000 });
  await expect(alice.page.getByTestId("toast").filter({ hasText: /going a bit fast/ })).toHaveCount(0);
});

test("hammering refresh never trips a limit", async ({ browser }) => {
  const alice = await newPlayer(browser);
  const bob = await newPlayer(browser);
  const url = await createRoom(alice.page, "Alice");
  await joinRoom(bob.page, url, "Bob");
  // Someone on a bad connection mashing Cmd+R, not waiting for pages to load.
  for (let i = 0; i < 15; i++) await bob.page.reload({ waitUntil: "commit" });
  await expectConnected(bob.page);
  await expect(bob.page.getByRole("alert")).toBeHidden();
  await expect(bob.page.getByTestId("toast")).toHaveCount(0);
  await sendChat(bob.page, "still here");
  await expect(chat(alice.page)).toContainText("still here");
  await expect(alice.page.getByTestId("member").filter({ hasText: "Bob" })).toHaveClass(/online/);
});

test("too many tabs pauses the oldest instead of fighting over the connection", async ({ browser }) => {
  const alice = await newPlayer(browser);
  const url = await createRoom(alice.page, "Alice");
  const tabs = [alice.page];
  for (let i = 0; i < 6; i++) {
    const tab = await alice.context.newPage();
    await tab.goto(url);
    await expectConnected(tab);
    tabs.push(tab);
  }
  const first = tabs[0]!;
  await expect(first.getByRole("heading", { name: "Open in another tab" })).toBeVisible();
  // It stays paused: no reconnect loop.
  await first.waitForTimeout(2000);
  await expect(first.getByRole("heading", { name: "Open in another tab" })).toBeVisible();
  await first.getByRole("button", { name: "Use this tab" }).click();
  await expectConnected(first);
});

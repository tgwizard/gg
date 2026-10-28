import { expect, type Page, test, type WebSocketRoute } from "@playwright/test";
import { chat, createRoom, expectConnected, joinRoom, myCards, newPlayer, openPokerTable, sendChat, sit } from "./helpers";

/**
 * Proxy a page's room WebSocket through Playwright so tests can cut it
 * (close it outright) or blackhole it (a half-open connection: nothing flows,
 * nothing closes — what a sleeping laptop or a dead NAT mapping looks like).
 */
async function proxySocket(page: Page) {
  const ctl = { flowing: true, routes: [] as WebSocketRoute[] };
  await page.routeWebSocket(/\/api\/rooms\/[^/]+\/ws$/, (ws) => {
    const server = ws.connectToServer();
    ctl.routes.push(ws);
    ws.onMessage((m) => ctl.flowing && server.send(m));
    server.onMessage((m) => ctl.flowing && ws.send(m));
  });
  return ctl;
}

test("going offline queues chat, and coming back delivers it and catches up", async ({ browser }) => {
  const alice = await newPlayer(browser);
  const bob = await newPlayer(browser);
  const url = await createRoom(alice.page, "Alice");
  await joinRoom(bob.page, url, "Bob");

  await alice.context.setOffline(true);
  await expect(alice.page.getByTestId("connection-status")).toHaveText(/Offline|Reconnecting/);
  await expect(alice.page.getByRole("alert")).toBeVisible();
  await expect(bob.page.getByTestId("member").filter({ hasText: "Alice" })).toHaveClass(/away/);

  await sendChat(alice.page, "sent while offline");
  await expect(alice.page.getByTestId("chat-pending")).toHaveText(/sent while offline/);
  await sendChat(bob.page, "you there?");

  await alice.context.setOffline(false);
  await expectConnected(alice.page);
  await expect(alice.page.getByTestId("chat-pending")).toHaveCount(0);
  await expect(chat(alice.page)).toContainText("you there?");
  await expect(chat(bob.page)).toContainText("sent while offline");
  await expect(alice.page.getByRole("alert")).toBeHidden();
});

test("a long queue of chat goes out at a pace the server takes, every message", async ({ browser }) => {
  const alice = await newPlayer(browser);
  const bob = await newPlayer(browser);
  const url = await createRoom(alice.page, "Alice");
  await joinRoom(bob.page, url, "Bob");

  await alice.context.setOffline(true);
  await expect(alice.page.getByTestId("connection-status")).toHaveText(/Offline|Reconnecting/);
  for (let i = 1; i <= 20; i++) await sendChat(alice.page, `queued ${i}`);
  await expect(alice.page.getByTestId("chat-pending")).toHaveCount(20);

  await alice.context.setOffline(false);
  await expect(alice.page.getByTestId("chat-pending")).toHaveCount(0, { timeout: 30_000 });
  const lines = bob.page.getByTestId("chat-message").filter({ hasText: /queued \d+/ });
  await expect(lines).toHaveCount(20);
  await expect(lines.last()).toContainText("queued 20");
});

test("a dropped connection reconnects on its own, mid-game", async ({ browser }) => {
  const alice = await newPlayer(browser);
  const bob = await newPlayer(browser);
  const ctl = await proxySocket(alice.page);
  const url = await createRoom(alice.page, "Alice");
  await joinRoom(bob.page, url, "Bob");
  await openPokerTable(alice.page);
  await sit(alice.page, 0);
  await sit(bob.page, 4);
  await alice.page.getByRole("button", { name: "Deal" }).click();
  const cards = await myCards(alice.page).then(async (c) => (c.length ? c : (await alice.page.waitForTimeout(300), myCards(alice.page))));
  expect(cards).toHaveLength(2);

  for (const ws of ctl.routes) await ws.close({ code: 1006 });
  await expectConnected(alice.page);
  expect(await myCards(alice.page)).toEqual(cards);

  // And the connection is genuinely usable afterwards.
  await sendChat(alice.page, "back again");
  await expect(chat(bob.page)).toContainText("back again");
});

test("a silent half-open connection is detected by the heartbeat", async ({ browser }) => {
  test.setTimeout(75_000);
  const alice = await newPlayer(browser);
  const bob = await newPlayer(browser);
  const ctl = await proxySocket(alice.page);
  const url = await createRoom(alice.page, "Alice");
  await joinRoom(bob.page, url, "Bob");

  ctl.flowing = false;
  await sendChat(bob.page, "said during the blackout");
  // Ping every 10s, declared dead after 8s without a reply.
  await expect(alice.page.getByTestId("connection-status")).toHaveText("Reconnecting", { timeout: 25_000 });
  ctl.flowing = true;
  // The attempt in flight lost its hello to the blackout, so it waits out the 10s connect timeout.
  await expectConnected(alice.page, 20_000);
  await expect(chat(alice.page)).toContainText("said during the blackout");
});

test("coming back to the tab checks the connection at once, and replaces a dead one in seconds", async ({ browser }) => {
  const { page } = await newPlayer(browser);
  await createRoom(page, "Alice");
  const dead = new Set<WebSocketRoute>();
  const sockets: WebSocketRoute[] = [];
  await page.routeWebSocket(/\/api\/rooms\/[^/]+\/ws$/, (ws) => {
    sockets.push(ws);
    const server = ws.connectToServer();
    ws.onMessage((m) => !dead.has(ws) && server.send(m));
    server.onMessage((m) => !dead.has(ws) && ws.send(m));
  });
  await page.reload();
  await expectConnected(page);
  // Away (another app), then back: a phone fires several of these at once.
  const comeBack = () =>
    page.evaluate(() => {
      const show = (state: string) => {
        Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
        document.dispatchEvent(new Event("visibilitychange"));
      };
      show("hidden");
      show("visible");
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false }));
    });

  // A live connection answers and is kept.
  let opened = sockets.length;
  await comeBack();
  await page.waitForTimeout(3_500);
  expect(sockets.length).toBe(opened);
  await expect(page.getByTestId("connection-status")).toHaveText("Connected");

  // One that died while away (still "open") is replaced well before the heartbeat would notice, once.
  for (const ws of sockets) dead.add(ws);
  opened = sockets.length;
  await page.waitForTimeout(2_000); // past the check for the last time it came back
  await comeBack();
  await expect.poll(() => sockets.length, { timeout: 5_000 }).toBe(opened + 1);
  await expectConnected(page, 5_000);
  await page.waitForTimeout(2_000);
  expect(sockets.length).toBe(opened + 1);
});

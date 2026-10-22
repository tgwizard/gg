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

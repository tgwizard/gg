import { expect, type Page, test, type WebSocketRoute } from "@playwright/test";
import { chat, createRoom, expectConnected, newPlayer, sendChat } from "./helpers";

/**
 * Pretend the server was deployed while the page was open: once `deploy()` is called,
 * the connection drops (as a deploy does) and every welcome after it carries a newer build.
 */
async function deployable(page: Page) {
  const ctl = { build: null as null | { id: string; games: Record<string, string> }, routes: [] as WebSocketRoute[], loads: 0 };
  page.on("load", () => ctl.loads++);
  await page.routeWebSocket(/\/api\/rooms\/[^/]+\/ws$/, (ws) => {
    ctl.routes.push(ws);
    const server = ws.connectToServer();
    ws.onMessage((m) => server.send(m));
    server.onMessage((m) => {
      if (ctl.build && typeof m === "string" && m.startsWith('{"type":"welcome"')) return ws.send(JSON.stringify({ ...JSON.parse(m), build: ctl.build }));
      ws.send(m);
    });
  });
  let deploys = 0;
  const deploy = async (games: Record<string, string> = {}) => {
    ctl.build = { id: `deploy-${++deploys}`, games };
    for (const ws of ctl.routes.splice(0)) await ws.close({ code: 1012 });
  };
  return { ctl, deploy };
}

const hideAndShow = (page: Page, state: "hidden" | "visible") =>
  page.evaluate((s) => {
    Object.defineProperty(document, "visibilityState", { value: s, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);

async function startTicTacToe(page: Page) {
  await page.getByRole("button", { name: /Tic-tac-toe/ }).click();
  await page.getByRole("button", { name: "Start tic-tac-toe" }).click();
  await expect(page.getByRole("button", { name: /Play as X$/ })).toBeVisible();
}

test("a page older than the server reloads once nothing's going on, and only once", async ({ browser }) => {
  const { page } = await newPlayer(browser);
  const { ctl, deploy } = await deployable(page);
  await createRoom(page, "Alice");
  const before = ctl.loads;
  await deploy();
  await expect.poll(() => ctl.loads, { timeout: 15_000 }).toBe(before + 1);
  await expectConnected(page);
  // Still older than the server after reloading (a deploy still spreading): it doesn't
  // reload again, it says so.
  await expect(page.getByTestId("update-banner")).toBeVisible();
  await page.waitForTimeout(3_000);
  expect(ctl.loads).toBe(before + 1);
});

test("an update waits while you type, and goes when you're done", async ({ browser }) => {
  const { page } = await newPlayer(browser);
  const { ctl, deploy } = await deployable(page);
  await createRoom(page, "Alice");
  await page.getByLabel("Chat message").fill("half a thought");
  await page.getByLabel("Chat message").blur();
  const before = ctl.loads;
  await deploy();
  await expect(page.getByTestId("update-banner")).toBeVisible();
  await page.waitForTimeout(3_000);
  expect(ctl.loads).toBe(before);
  await expect(page.getByLabel("Chat message")).toHaveValue("half a thought");
  // Hidden, it still waits: the text would be lost.
  await hideAndShow(page, "hidden");
  await page.waitForTimeout(500);
  expect(ctl.loads).toBe(before);
  await hideAndShow(page, "visible");
  await sendChat(page, "a whole thought");
  await expect(chat(page)).toContainText("a whole thought");
  await page.getByLabel("Chat message").blur();
  await expect.poll(() => ctl.loads, { timeout: 15_000 }).toBe(before + 1);
});

test("with a game on, an update waits for the tab to be hidden, or for the page to change", async ({ browser }) => {
  const { page } = await newPlayer(browser);
  const { ctl, deploy } = await deployable(page);
  await createRoom(page, "Alice");
  await startTicTacToe(page);
  let before = ctl.loads;
  await deploy();
  await expect(page.getByTestId("update-banner")).toBeVisible();
  await page.waitForTimeout(3_000);
  expect(ctl.loads).toBe(before);
  // The game plays on meanwhile (its rules didn't change).
  await page.getByRole("button", { name: /Play as X$/ }).click();
  await expect(page.getByTestId("ttt-seat-0")).toContainText("Alice");
  // Away from the tab: it reloads, and you're back at the game.
  await hideAndShow(page, "hidden");
  await expect.poll(() => ctl.loads, { timeout: 15_000 }).toBe(before + 1);
  await expectConnected(page);
  await expect(page.getByTestId("ttt-seat-0")).toContainText("Alice");

  // Another deploy: going home is a full page load.
  before = ctl.loads;
  await deploy();
  await expect(page.getByTestId("update-banner")).toBeVisible();
  await page.locator("a.brand").click();
  await expect.poll(() => ctl.loads, { timeout: 15_000 }).toBe(before + 1);
  await expect(page.getByRole("button", { name: "Create a room" })).toBeVisible();
});

test("a game whose rules changed says so in its place, and the room still works", async ({ browser }) => {
  const { page } = await newPlayer(browser);
  const { deploy } = await deployable(page);
  await createRoom(page, "Alice");
  await startTicTacToe(page);
  await deploy({ tictactoe: "changed" });
  const notice = page.getByTestId("game-outdated");
  await expect(notice).toContainText("Tic-tac-toe has been updated");
  await expect(page.getByRole("button", { name: /Play as X$/ })).toHaveCount(0);
  await expect(page.getByTestId("update-banner")).toHaveCount(0);
  await sendChat(page, "still here");
  await expect(chat(page)).toContainText("still here");
  await notice.getByRole("button", { name: "Reload" }).click();
  await expectConnected(page);
});

test("an update waits while a game is being set up", async ({ browser }) => {
  const { page } = await newPlayer(browser);
  const { ctl, deploy } = await deployable(page);
  await createRoom(page, "Alice");
  await page.getByRole("button", { name: /Tic-tac-toe/ }).click();
  await expect(page.getByTestId("game-setup")).toBeVisible();
  const before = ctl.loads;
  await deploy();
  await expect(page.getByTestId("update-banner")).toBeVisible();
  await page.waitForTimeout(3_000);
  expect(ctl.loads).toBe(before);
  // Back to the list of games, nothing's going on: it goes.
  await page.getByRole("button", { name: "← All games" }).click();
  await expect.poll(() => ctl.loads, { timeout: 15_000 }).toBe(before + 1);
});

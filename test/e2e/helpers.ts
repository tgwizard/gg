import { type Browser, expect, type Page } from "@playwright/test";

const octet = () => Math.floor(Math.random() * 256);

/**
 * Each player gets their own browser context: separate localStorage, so a separate
 * identity, and their own IP (as the local worker sees it) so per-IP limits behave
 * like real players on different networks.
 */
export async function newPlayer(browser: Browser, ip = `10.${octet()}.${octet()}.${octet()}`) {
  const context = await browser.newContext({ extraHTTPHeaders: { "CF-Connecting-IP": ip } });
  const page = await context.newPage();
  return { context, page };
}

export async function createRoom(page: Page, name: string): Promise<string> {
  await page.goto("/");
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Create a room" }).click();
  await page.waitForURL(/\/r\/[0-9A-Z]{10}$/);
  await expectConnected(page);
  return page.url();
}

export async function joinRoom(page: Page, url: string, name: string) {
  await page.goto(url);
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join room" }).click();
  await expectConnected(page);
}

// Generous by default: with the whole suite running in parallel, a page can take a while to load and connect.
export async function expectConnected(page: Page, timeout = 15_000) {
  await expect(page.getByTestId("connection-status")).toHaveText("Connected", { timeout });
}

export async function sendChat(page: Page, text: string) {
  await page.getByLabel("Chat message").fill(text);
  await page.getByLabel("Chat message").press("Enter");
}

export function chat(page: Page) {
  return page.getByTestId("chat-list");
}

/** Start poker from the game picker with default settings. */
export async function openPokerTable(page: Page, settings: { turnSeconds?: number } = {}) {
  await page.getByRole("button", { name: /Texas Hold'em/ }).click();
  if (settings.turnSeconds !== undefined) await page.getByLabel(/Turn timer/).fill(String(settings.turnSeconds));
  await page.getByRole("button", { name: "Open the table" }).click();
  await expect(page.getByTestId("poker-table")).toBeVisible();
}

export async function sit(page: Page, seat: number) {
  await page.getByTestId(`seat-${seat}`).getByRole("button", { name: "Sit here" }).click();
  await expect(page.locator(".seat.me")).toBeVisible();
}

/** Hole cards visible in the viewer's own seat. */
export async function myCards(page: Page): Promise<string[]> {
  return page.locator(".seat.me [data-card]").evaluateAll((els) => els.map((e) => e.getAttribute("data-card")!));
}

/** Play passively (check, else call) until the hand ends. */
export async function playOutHand(pages: Page[]) {
  const result = pages[0]!.getByTestId("hand-result");
  for (let i = 0; i < 40; i++) {
    if (await result.isVisible()) return;
    for (const page of pages) {
      const actions = page.getByTestId("actions");
      if (await actions.isVisible()) {
        const check = actions.getByRole("button", { name: "Check" });
        // The other player's move can end the round between looking and clicking, and then
        // the button is gone: give up on it quickly and look again.
        await ((await check.isVisible()) ? check : actions.getByRole("button", { name: /^Call/ })).click({ timeout: 1_000 }).catch(() => {});
        // The same player may act again (e.g. the big blind opens the flop heads-up); let the update land.
        await page.waitForTimeout(250);
      }
    }
    await pages[0]!.waitForTimeout(150);
  }
  await expect(result).toBeVisible();
}

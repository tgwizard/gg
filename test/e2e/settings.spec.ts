import { expect, type Route, test } from "@playwright/test";

/**
 * /settings against a fake Meta Model API (an OpenAI-style Responses API), so the whole
 * browser-side flow runs: reject a bad key, add a good one, stream a reply, remove it.
 */

const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET, POST, OPTIONS" };
const GOOD = "meta-good-key";

function preflight(route: Route) {
  if (route.request().method() !== "OPTIONS") return false;
  void route.fulfill({ status: 204, headers: cors });
  return true;
}

test("change your name and color in settings", async ({ page }) => {
  await page.goto("/settings");
  await page.getByLabel("Your name").fill("Robin");
  await page.getByLabel("Your name").press("Enter");
  await page.getByRole("radio").nth(5).click();
  // At home: you, in the corner.
  await page.goto("/");
  await page.getByRole("button", { name: /Robin/ }).click();
  await expect(page.getByRole("dialog", { name: "Your profile" }).getByLabel("Your name")).toHaveValue("Robin");
  await expect(page.getByRole("dialog", { name: "Your profile" }).getByRole("radio").nth(5)).toBeChecked();
});

test("delete all data deletes everything, the player secret too", async ({ page }) => {
  await page.goto("/settings");
  await page.getByLabel("Your name").fill("Robin");
  await page.getByLabel("Your name").press("Enter");
  await page.evaluate(() => {
    localStorage.setItem("gg.mode", "dark");
    localStorage.setItem("gg.llm.connections", JSON.stringify([{ id: "1", provider: "meta", label: "Meta key", addedAt: "2026-10-23T00:00:00Z", apiKey: "k" }]));
    localStorage.setItem("gg.secret", "s3cret");
    sessionStorage.setItem("gg.pendingChat.ROOM", "[]");
  });

  await page.getByRole("button", { name: "Delete all data" }).click();
  await page.getByRole("button", { name: "Yes, delete everything" }).click();
  // Back home, as someone new.
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByLabel("Your name")).toHaveValue("");

  const left = await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }));
  for (const key of ["gg.name", "gg.mode", "gg.llm.connections"]) expect(left.local).not.toHaveProperty(key);
  // A page that needs an identity makes a new one; the old one is gone.
  expect(left.local["gg.secret"]).not.toBe("s3cret");
  expect(left.session).toEqual({});
});

test("add Meta keys, make an AI bot with one, remove it", async ({ page, context }) => {
  await context.addInitScript(() => {
    // A ChatGPT sign-in saved by an older version: ignored, not a crash.
    if (!localStorage.getItem("gg.llm.connections")) {
      localStorage.setItem("gg.llm.connections", JSON.stringify([{ id: "old", provider: "chatgpt", label: "old@example.com", accessToken: "x" }]));
    }
  });
  await context.route("https://api.meta.ai/v1/models", async (route) => {
    if (preflight(route)) return;
    if (route.request().headers()["authorization"] !== `Bearer ${GOOD}`) {
      return route.fulfill({ status: 401, headers: cors, json: { error: { message: "Invalid API key." } } });
    }
    const ids = ["muse-image-1.0", "muse-spark-1.2", "muse-spark-1.3", "muse-spark-1.3-contributor", "sam-3.1"];
    await route.fulfill({ headers: cors, json: { object: "list", data: ids.map((id) => ({ id, object: "model", owned_by: "meta" })) } });
  });

  await page.goto("/");
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await page.getByRole("tab", { name: "Bots & AI" }).click();
  await expect(page).toHaveURL(/\/settings#bots$/);
  await expect(page.getByTestId("ai-connection")).toHaveCount(0);

  // Keys are kept as given; one the provider turns down says so on its card.
  await page.getByLabel("Provider").selectOption("meta");
  await page.getByLabel("API key").fill("meta-bad-key");
  await page.getByRole("button", { name: "Add key" }).click();
  const bad = page.getByTestId("ai-connection");
  await expect(bad).toContainText(/Invalid API key/);
  await bad.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByTestId("ai-connection")).toHaveCount(0);

  await page.getByLabel("Provider").selectOption("meta");
  await page.getByLabel("API key").fill(GOOD);
  await page.getByRole("button", { name: "Add key" }).click();
  const card = page.getByTestId("ai-connection");
  await expect(card).toContainText("Meta Model API key");
  await expect(card).toContainText("No bots use it yet");
  await expect(card).not.toContainText(GOOD); // only a masked form of the key is shown
  await expect(page.getByLabel("API key")).toHaveValue("");

  // A bot that plays with it: the cheapest model at the lowest effort, unless picked otherwise.
  await page.getByRole("button", { name: "+ New bot" }).click();
  await page.getByLabel("Bot's name").fill("Captain");
  await page.getByLabel("Personality").fill("A grumpy old sea captain.");
  await page.getByLabel("Plays").selectOption({ index: 2 });
  await expect(page.getByRole("combobox", { name: "Model" })).toHaveValue("muse-spark-1.3-contributor");
  await expect(page.getByRole("combobox", { name: "Model" }).getByRole("option")).toHaveCount(3); // chat models only
  await expect(page.getByRole("combobox", { name: "Effort" })).toHaveValue("low");
  await page.getByRole("button", { name: "Make bot" }).click();
  const bot = page.getByTestId("bot-card").filter({ hasText: "Captain" });
  await expect(bot).toContainText("AI bot · muse-spark-1.3-contributor · low effort · in no rooms yet");
  await expect(bot).toContainText("A grumpy old sea captain.");
  await expect(card).toContainText("Used by Captain");

  // It's remembered in this browser.
  await page.reload();
  await expect(bot).toBeVisible();

  // Delete all bots, behind a confirmation.
  await page.getByRole("button", { name: "+ New bot" }).click();
  await page.getByRole("button", { name: "Make bot" }).click();
  await expect(page.getByTestId("bot-card")).toHaveCount(2);
  await page.getByRole("button", { name: "Delete all bots" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("bot-card")).toHaveCount(2);

  // Without its key, it plays built-in.
  await card.getByRole("button", { name: "Remove" }).click();
  await expect(card).toHaveCount(0);
  await expect(bot).toContainText("Built-in bot · hard · no AI");
  expect(await page.evaluate(() => localStorage.getItem("gg.llm.connections"))).toBe("[]");
  await page.getByRole("button", { name: "Delete all bots" }).click();
  await page.getByRole("button", { name: "Delete all", exact: true }).click();
  await expect(page.getByTestId("bot-card")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "+ New bot" })).toBeVisible();
});

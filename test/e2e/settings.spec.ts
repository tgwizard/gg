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
  await page.goto("/");
  await expect(page.getByLabel("Your name")).toHaveValue("Robin");
  await expect(page.getByRole("radio").nth(5)).toBeChecked();
});

test("delete all data keeps only the player secret", async ({ page }) => {
  await page.goto("/settings");
  await page.getByLabel("Your name").fill("Robin");
  await page.getByLabel("Your name").press("Enter");
  await page.evaluate(() => {
    localStorage.setItem("gg.mode", "dark");
    localStorage.setItem("gg.llm.connections", JSON.stringify([{ id: "1", provider: "meta", label: "Meta key", addedAt: "2026-10-23T00:00:00Z", apiKey: "k" }]));
    localStorage.setItem("someone-else", "untouched");
  });
  const secret = await page.evaluate(() => {
    // Any room visit creates it; make sure there's one to keep.
    if (!localStorage.getItem("gg.secret")) localStorage.setItem("gg.secret", "s3cret");
    return localStorage.getItem("gg.secret");
  });

  await page.getByRole("button", { name: "Delete all data" }).click();
  await page.getByRole("button", { name: "Yes, delete everything" }).click();
  await page.waitForLoadState("load");
  await expect(page.getByLabel("Your name")).toHaveValue("");
  await expect(page.getByTestId("ai-connection")).toHaveCount(0);

  const left = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])));
  expect(left["gg.secret"]).toBe(secret);
  expect(left["someone-else"]).toBe("untouched");
  for (const key of ["gg.name", "gg.mode", "gg.llm.connections"]) expect(left).not.toHaveProperty(key);
});

test("add a Meta key, run a prompt, remove it", async ({ page, context }) => {
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
  const requests: { model: string; reasoning?: { effort: string } }[] = [];
  await context.route("https://api.meta.ai/v1/responses", async (route) => {
    if (preflight(route)) return;
    expect(route.request().headers()["authorization"]).toBe(`Bearer ${GOOD}`);
    expect(route.request().postDataJSON()).toMatchObject({ store: false, stream: true });
    requests.push(route.request().postDataJSON());
    const events = [
      { type: "response.output_text.delta", delta: "Hello, " },
      { type: "response.output_text.delta", delta: "table!" },
      { type: "response.completed", response: { usage: { input_tokens: 12, output_tokens: 4 } } },
    ];
    await route.fulfill({
      headers: { ...cors, "content-type": "text/event-stream" },
      body: events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(""),
    });
  });

  await page.goto("/");
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByTestId("ai-connection")).toHaveCount(0);

  await page.getByLabel("Provider").selectOption("meta");
  await page.getByLabel("API key").fill("meta-bad-key");
  await page.getByRole("button", { name: "Add key" }).click();
  await expect(page.getByText(/Invalid API key/)).toBeVisible();
  await expect(page.getByTestId("ai-connection")).toHaveCount(0);

  await page.getByLabel("API key").fill(GOOD);
  await page.getByRole("button", { name: "Add key" }).click();
  const card = page.getByTestId("ai-connection");
  await expect(card).toContainText("Meta Model API key");
  await expect(card).not.toContainText(GOOD); // only a masked form of the key is shown
  await expect(page.getByLabel("API key")).toHaveValue("");
  // Starts on the cheapest model and the lowest effort.
  const model = card.getByLabel("Model");
  const effort = card.getByLabel("Effort");
  await expect(model).toHaveValue("muse-spark-1.3-contributor");
  await expect(model.getByRole("option")).toHaveCount(3); // chat models only
  await expect(effort).toHaveValue("low");

  await card.getByRole("button", { name: "Run" }).click();
  await expect(card.getByTestId("ai-output")).toHaveText("Hello, table!");
  await expect(card).toContainText("12 in · 4 out");
  expect(requests.at(-1)).toMatchObject({ model: "muse-spark-1.3-contributor", reasoning: { effort: "low" } });

  await model.selectOption("muse-spark-1.3");
  await effort.selectOption("high");
  await card.getByRole("button", { name: "Run" }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests.at(-1)).toMatchObject({ model: "muse-spark-1.3", reasoning: { effort: "high" } });
  await expect(card.getByTestId("ai-output")).toHaveText("Hello, table!");

  // It's remembered in this browser.
  await page.reload();
  await expect(model).toHaveValue("muse-spark-1.3");
  await expect(effort).toHaveValue("high");

  await card.getByRole("button", { name: "Remove" }).click();
  await expect(card).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("gg.llm.connections"))).toBe("[]");
});

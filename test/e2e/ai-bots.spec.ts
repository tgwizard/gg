import { expect, type Route, test } from "@playwright/test";
import { chat, createRoom, joinRoom, newPlayer } from "./helpers";

/**
 * An AI bot against a fake Meta Model API (an OpenAI-style Responses API): the fake
 * model makes the first legal move it's offered and answers when someone says hello.
 * Checks the whole loop in a real browser: the prompt, the act tool, moves and chat
 * going through the room, and the conversation only ever growing at the end (which
 * is what keeps it cached).
 */

const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET, POST, OPTIONS" };

type Item = { role?: string; type?: string; content?: unknown; call_id?: string; output?: string };
interface Body {
  model: string;
  instructions: string;
  input: Item[];
  tools: { name: string; parameters: unknown }[];
}

function lastUpdate(input: Item[]): string {
  const last = [...input].reverse().find((i) => i.role === "user");
  return typeof last?.content === "string" ? last.content : "";
}

test("an AI bot plays tic-tac-toe and chats", async ({ browser }) => {
  const { page, context } = await newPlayer(browser);
  await context.addInitScript(() => {
    if (localStorage.getItem("gg.llm.connections")) return;
    localStorage.setItem(
      "gg.llm.connections",
      JSON.stringify([{ id: "meta1", provider: "meta", label: "Meta key", addedAt: "2026-10-23T09:00:00Z", apiKey: "fake-key", model: "muse-spark-1.3", models: ["muse-spark-1.3", "muse-spark-1.3-contributor", "muse-spark-1.2"] }]),
    );
  });
  const requests: Body[] = [];
  let calls = 0;
  await context.route("https://api.meta.ai/v1/responses", async (route: Route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const body = route.request().postDataJSON() as Body;
    requests.push(body);
    const update = lastUpdate(body.input);
    const moves = /Legal moves:\n(.+)/.exec(update);
    const args: { op?: unknown; say?: string } = {};
    if (moves) args.op = JSON.parse(moves[1]!);
    if (/Alice: hello/.test(update)) args.say = body.tools[0]!.parameters && /"op"/.test(JSON.stringify(body.tools[0]!.parameters)) ? "Ahoy, Alice!" : "Ahoy! Pick a game, Alice!";
    // Moves take the fake model a moment, so its "thinking" bubble can be seen.
    if (moves) await new Promise((r) => setTimeout(r, 1200));
    const call = { type: "function_call", id: `fc_${++calls}`, call_id: `call_${calls}`, name: "act", arguments: JSON.stringify(args), status: "completed" };
    const completed = { type: "response.completed", response: { output: [call], usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 800 }, output_tokens: 20 } } };
    await route.fulfill({ headers: { ...cors, "content-type": "text/event-stream" }, body: `event: ${completed.type}\ndata: ${JSON.stringify(completed)}\n\n` });
  });

  await createRoom(page, "Alice");
  await page.getByRole("complementary").getByRole("button", { name: "+ Add a bot" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a bot" });
  await dialog.getByLabel("Bot's name").fill("Pirate");
  await dialog.getByLabel("Plays").selectOption({ label: "AI · Meta key" });
  // The cheapest model at low effort, unless picked otherwise.
  await expect(dialog.getByLabel("Model")).toHaveValue("muse-spark-1.3-contributor");
  await expect(dialog.getByLabel("Effort")).toHaveValue("low");
  await expect(dialog).toContainText("AI bot · muse-spark-1.3-contributor · low effort");
  await dialog.getByLabel(/Personality/).fill("A pirate who loves the sea.");
  await dialog.getByRole("button", { name: "Add bot" }).click();
  await expect(page.getByTestId("member").filter({ hasText: "Pirate" })).toContainText("AI bot");

  // Before any game, it chats (with a tool that has no moves).
  await page.getByLabel("Chat message").fill("hello, anyone here?");
  await page.getByLabel("Chat message").press("Enter");
  await expect(chat(page)).toContainText("Ahoy! Pick a game, Alice!");
  expect(requests[0]!.instructions).toContain("No game is being played right now");

  await page.getByRole("button", { name: /Tic-tac-toe/ }).click();
  await page.getByRole("button", { name: "Start tic-tac-toe" }).click();
  await page.getByRole("button", { name: /Play as X$/ }).click();
  await expect(page.getByTestId("ttt-seat-1")).toContainText("Pirate");
  const lobbyCalls = requests.length;

  // Alice plays down the right column; the bot takes the first free square each time.
  for (const cell of [2, 5, 8]) {
    await expect(page.getByTestId("ttt-status")).toHaveText("Your move (X)", { timeout: 10_000 });
    await page.getByTestId(`ttt-cell-${cell}`).click();
    if (cell === 2) {
      // While its model works, everyone sees what it's doing, on its nameplate and in the members list.
      await expect(page.getByTestId("ttt-seat-1").getByRole("status")).toHaveText("Thinking about its move");
      await expect(page.getByTestId("member").filter({ hasText: "Pirate" }).getByRole("status")).toHaveText("Thinking about its move");
    }
  }
  await expect(chat(page)).toContainText("Round 1: Alice wins as X.");

  await page.getByLabel("Chat message").fill("hello there, Pirate");
  await page.getByLabel("Chat message").press("Enter");
  await expect(chat(page)).toContainText("Ahoy, Alice!");

  // What the model saw in the game: who it is, the rules, one tool with only game moves.
  const first = requests[lobbyCalls]!;
  expect(first.model).toBe("muse-spark-1.3-contributor");
  expect(first).toMatchObject({ reasoning: { effort: "low" } });
  expect(first.instructions).toContain("You are Pirate");
  expect(first.instructions).toContain("A pirate who loves the sea.");
  expect(first.instructions).toContain("Three in a row");
  expect(first.tools.map((t) => t.name)).toEqual(["act"]);
  expect(JSON.stringify(first.tools[0]!.parameters)).not.toContain('"sit"');
  // Each request repeats the previous one and adds to the end.
  for (let i = lobbyCalls + 1; i < requests.length; i++) {
    const before = requests[i - 1]!.input;
    expect(requests[i]!.input.slice(0, before.length)).toEqual(before);
    expect(requests[i]!.instructions).toBe(first.instructions);
  }
  // A move's result opens the next update.
  expect(requests.some((r) => r.input.some((i) => i.type === "function_call_output" && i.output?.startsWith("Move made.")))).toBe(true);

  // The owner sees what it has used, and can change how it thinks.
  await page.getByRole("button", { name: "Edit Pirate" }).click();
  const edit = page.getByRole("dialog", { name: "Edit Pirate" });
  await expect(edit.getByTestId("bot-usage")).toContainText(`over ${requests.length} calls`);
  await edit.getByLabel("Model").selectOption("muse-spark-1.2");
  await edit.getByLabel("Effort").selectOption("medium");
  await edit.getByRole("button", { name: "Save" }).click();
  const before = requests.length;
  await page.getByLabel("Chat message").fill("hello again, Pirate");
  await page.getByLabel("Chat message").press("Enter");
  await expect.poll(() => requests.length).toBeGreaterThan(before);
  expect(requests.at(-1)).toMatchObject({ model: "muse-spark-1.2", reasoning: { effort: "medium" } });
});

test("when the model fails, the built-in bot moves for it, after a moment, and the owner can see why", async ({ browser }) => {
  const { page, context } = await newPlayer(browser);
  await context.addInitScript(() => {
    if (localStorage.getItem("gg.llm.connections")) return;
    localStorage.setItem(
      "gg.llm.connections",
      JSON.stringify([{ id: "meta1", provider: "meta", label: "Meta key", addedAt: "2026-10-23T09:00:00Z", apiKey: "fake-key", model: "muse-spark-1.3", models: ["muse-spark-1.3-contributor"] }]),
    );
  });
  await context.route("https://api.meta.ai/v1/responses", (route: Route) =>
    route.request().method() === "OPTIONS"
      ? route.fulfill({ status: 204, headers: cors })
      : route.fulfill({ status: 400, headers: cors, json: { error: { message: "Model is overloaded." } } }),
  );

  await createRoom(page, "Alice");
  await page.getByRole("complementary").getByRole("button", { name: "+ Add a bot" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a bot" });
  await dialog.getByLabel("Bot's name").fill("Glitch");
  await dialog.getByLabel("Plays").selectOption({ label: "AI · Meta key" });
  await dialog.getByRole("button", { name: "Add bot" }).click();
  await page.getByRole("button", { name: /Tic-tac-toe/ }).click();
  await page.getByRole("button", { name: "Start tic-tac-toe" }).click();
  await page.getByRole("button", { name: /Play as X$/ }).click();
  await expect(page.getByTestId("ttt-seat-1")).toContainText("Glitch");

  await page.getByTestId("ttt-cell-4").click();
  const clicked = Date.now();
  await expect(page.getByTestId("ttt-seat-1").getByRole("status")).toHaveText("Playing without AI");
  await expect(page.getByTestId("ttt-status")).toHaveText("Your move (X)", { timeout: 10_000 });
  expect(Date.now() - clicked).toBeGreaterThan(500);
  await expect(page.getByTestId("member").filter({ hasText: "Glitch" })).toContainText("AI problem");

  await page.getByRole("button", { name: "Edit Glitch" }).click();
  await expect(page.getByTestId("bot-stand-ins")).toContainText("The built-in bot made 1 move for it");
  await expect(page.getByTestId("bot-stand-ins")).toContainText("Model is overloaded");

  // It comes back, still an AI bot, after a refresh.
  await page.reload();
  const glitch = page.getByTestId("member").filter({ hasText: "Glitch" });
  await expect(glitch).toHaveClass(/online/);
  await expect(glitch).toContainText("AI bot");
  await expect(page.getByTestId("ttt-seat-1")).toContainText("Glitch");
});

test("other people see that a bot is an AI bot, which model it runs, and whose browser it plays from", async ({ browser }) => {
  const alice = await newPlayer(browser);
  const bob = await newPlayer(browser);
  await alice.context.addInitScript(() => {
    if (localStorage.getItem("gg.llm.connections")) return;
    localStorage.setItem(
      "gg.llm.connections",
      JSON.stringify([{ id: "meta1", provider: "meta", label: "Meta key", addedAt: "2026-10-23T09:00:00Z", apiKey: "fake-key", model: "muse-spark-1.3", models: ["muse-spark-1.3", "muse-spark-1.3-contributor"] }]),
    );
  });
  const url = await createRoom(alice.page, "Alice");
  await joinRoom(bob.page, url, "Bob");
  await alice.page.getByRole("complementary").getByRole("button", { name: "+ Add a bot" }).click();
  const dialog = alice.page.getByRole("dialog", { name: "Add a bot" });
  await dialog.getByLabel("Bot's name").fill("Luna");
  await dialog.getByLabel("Plays").selectOption({ label: "AI · Meta key" });
  await dialog.getByLabel("Effort").selectOption("medium");
  await dialog.getByRole("button", { name: "Add bot" }).click();

  const luna = bob.page.getByTestId("member").filter({ hasText: "Luna" });
  await expect(luna).toContainText("AI bot");
  await expect(luna).not.toContainText("×");
  await luna.getByRole("button", { name: "About Luna" }).click();
  const about = bob.page.getByRole("dialog", { name: "About Luna" });
  await expect(about).toContainText("muse-spark-1.3-contributor");
  await expect(about).toContainText("medium");
  await expect(about).toContainText("Meta");
  await expect(about).toContainText("Alice added it, and it plays from Alice's browser, with Alice's own AI key.");

  // Switching it to built-in shows up for everyone.
  await alice.page.getByRole("button", { name: "Edit Luna" }).click();
  const edit = alice.page.getByRole("dialog", { name: "Edit Luna" });
  await edit.getByLabel("Plays").selectOption("easy");
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(luna.locator(".tag.brand")).toHaveText("bot");
});

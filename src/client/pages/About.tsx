/** /about: what gg is, how it treats your data, and where the code is. */
import { useState } from "react";
import { ModeToggle } from "../components/ModeToggle";
import { cameFrom, navigate } from "../router";

export function AboutPage() {
  const [back] = useState(cameFrom);
  return (
    <div className="guide settings about">
      <header className="guide-head on-brand">
        <a
          className="settings-back"
          href={back ?? "/"}
          onClick={(e) => {
            e.preventDefault();
            navigate(back ?? "/");
          }}
        >
          ← gg
        </a>
        <h1 className="display">About gg</h1>
        <p>Games with friends, in the browser.</p>
        <ModeToggle />
      </header>

      <main className="guide-main settings-main">
        <section className="stack">
          <h2 className="display settings-h2">What it is</h2>
          <p className="settings-text">
            Make a room, send the link, play. There are no accounts and nothing to install: you pick a name, and it's kept in your browser. Rooms have a chat
            that the games talk in too, and if you're short of players, add a bot: a built-in one, or one run by an AI model with a key of your own.
          </p>
          <p className="settings-text">
            Built with love, using AI. The games are inspired by classic and modern games, with no claim on their copyright.
          </p>
        </section>

        <section className="stack">
          <h2 className="display settings-h2">Privacy</h2>
          <ul className="about-list">
            <li>Rooms are private to whoever has the link. There's no list of rooms to browse.</li>
            <li>Your name, color and settings are kept in this browser, not on a server.</li>
            <li>
              AI keys stay in this browser too. An AI bot's requests go straight from your browser to the AI provider, never through gg, and they include the
              room's chat and the bot's view of the game.
            </li>
            <li>Rooms are deleted after 30 days without anyone in them.</li>
          </ul>
        </section>

        <section className="stack">
          <h2 className="display settings-h2">Open source</h2>
          <p className="settings-text">
            gg is made by Adam Renberg Tamm. The code is on <a href="https://github.com/tgwizard/gg">GitHub</a> under the MIT license; issues and ideas are
            welcome there.
          </p>
          <p className="settings-text">
            Feedback welcome: <a href="mailto:tgwizard@gmail.com">tgwizard@gmail.com</a>
          </p>
        </section>
      </main>
    </div>
  );
}

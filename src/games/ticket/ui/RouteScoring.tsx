import { LONGEST_BONUS } from "../engine";
import { ROUTE_POINTS } from "../map";
import { useShownMap } from "./mapContext";
import "./ticket.css";

const LENGTHS = Object.keys(ROUTE_POINTS)
  .map(Number)
  .sort((a, b) => a - b);

/** For the rules: what a route scores by its length, drawn as trains, with how many of each the map being played has. */
export function RouteScoring() {
  const map = useShownMap();
  return (
    <section className="ttr-scoring" aria-label="Points per route">
      <h4 className="label">Points per route</h4>
      <ol>
        {LENGTHS.map((n) => {
          const points = ROUTE_POINTS[n]!;
          const onMap = map.routes.filter((r) => r.length === n).length;
          return (
            <li key={n}>
              <span className="ttr-scoring-cars" aria-hidden>
                {Array.from({ length: n }, (_, i) => (
                  <i key={i} />
                ))}
              </span>
              <span className="ttr-scoring-len">
                {n} {n === 1 ? "train" : "trains"}
                <span className="muted">{onMap} on the map</span>
              </span>
              <span className="ttr-scoring-pts">
                <span className="num">{points}</span> {points === 1 ? "pt" : "pts"}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="muted small">
        Longer routes are worth more for each train: one 6-train route scores {ROUTE_POINTS[6]}, six 1-train routes only {6 * ROUTE_POINTS[1]!}. At the end, each ticket adds its points if
        you've joined its cities and takes them away if you haven't, and the longest continuous railway scores {LONGEST_BONUS} more.
      </p>
    </section>
  );
}

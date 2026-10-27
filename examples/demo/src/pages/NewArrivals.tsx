import { holdPrerender, Seo } from "@anubhav-choubey/web-for-agents";
import { useEffect, useState } from "react";
import { NEW_ARRIVALS } from "../data";

/** Simulates a slow data source with a timer, which the renderer cannot see; holdPrerender tells it to wait. */
function loadArrivals(): Promise<typeof NEW_ARRIVALS> {
  return new Promise((resolve) => setTimeout(() => resolve(NEW_ARRIVALS), 200));
}

export function NewArrivals() {
  const [items, setItems] = useState<typeof NEW_ARRIVALS | null>(null);
  useEffect(() => {
    const release = holdPrerender();
    loadArrivals()
      .then(setItems)
      .finally(release);
  }, []);
  return (
    <>
      <Seo title="New arrivals" description="Books that just landed on the shelves at Paper Lantern Books this month." canonical="/new-arrivals" />
      <h1>New arrivals</h1>
      {items === null ? (
        <p>Loading the new arrivals</p>
      ) : (
        <ul>
          {items.map((i) => (
            <li key={i.title}>
              {i.title} by {i.author}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

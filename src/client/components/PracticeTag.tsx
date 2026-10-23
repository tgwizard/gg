import { useEffect, useState } from "react";

/** "Practice" in the top bar of a practice room (one made from /try), whose game can be set up. */
export function PracticeTag({ roomId }: { roomId: string }) {
  const [practice, setPractice] = useState(false);
  useEffect(() => {
    let live = true;
    fetch(`/api/rooms/${roomId}`)
      .then((res) => (res.ok ? (res.json() as Promise<{ practice?: boolean }>) : null))
      .then((info) => live && setPractice(info?.practice === true))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [roomId]);
  if (!practice) return null;
  return (
    <span className="tag" title="A practice room: its game was set up in a ready-made position" data-testid="practice-tag">
      Practice
    </span>
  );
}

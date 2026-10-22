import { useEffect, useState, useSyncExternalStore } from "react";
import { RoomClient } from "./RoomClient";

export function useRoom(roomId: string, secret: string, name: string, color: number) {
  const [client] = useState(() => new RoomClient(roomId, secret, name, color));
  useEffect(() => {
    client.start();
    return () => client.stop();
  }, [client]);
  useEffect(() => client.setProfile(name, color), [client, name, color]);
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot);
  return { client, snapshot };
}

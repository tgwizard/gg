import { useEffect, useState, useSyncExternalStore } from "react";
import { RoomClient } from "./RoomClient";

export function useRoom(roomId: string, secret: string, name: string) {
  const [client] = useState(() => new RoomClient(roomId, secret, name));
  useEffect(() => {
    client.start();
    return () => client.stop();
  }, [client]);
  useEffect(() => client.setName(name), [client, name]);
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot);
  return { client, snapshot };
}

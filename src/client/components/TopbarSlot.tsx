/**
 * A place in the room's top bar that the running game can put its header in (icon,
 * name, help, settings, End game), leaving the page below for the game itself. On
 * narrow screens the top bar is full already, so the header stays on the page.
 */
import { createContext, type ReactNode, useContext } from "react";
import { createPortal } from "react-dom";
import { useMedia } from "../../ui";

const Slot = createContext<HTMLElement | null>(null);

export const TopbarSlotProvider = Slot.Provider;

export function InTopbar({ children }: { children: ReactNode }) {
  const slot = useContext(Slot);
  const narrow = useMedia("(max-width: 860px)");
  return slot && !narrow ? createPortal(children, slot) : children;
}

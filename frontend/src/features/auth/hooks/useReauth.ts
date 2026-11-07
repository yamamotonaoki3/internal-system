import { useContext } from "react";
import { ReauthContext } from "../ReauthProvider";

export function useReauth() {
  const context = useContext(ReauthContext);
  if (!context) throw new Error("useReauth は ReauthProvider の中で使います");
  return context;
}

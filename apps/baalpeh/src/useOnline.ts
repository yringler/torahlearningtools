import { useEffect, useState } from "react";

/** The browser's online flag, kept current. */
export function useNavigatorOnline(): boolean {
  const [nav, setNav] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setNav(true);
    const off = () => setNav(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  return nav;
}

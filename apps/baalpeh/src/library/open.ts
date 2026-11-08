import { createContext, useContext } from "react";
import type { ReadPlace } from "./location";

/** The child the library was opened for (shown in its top bar). */
export interface LibraryChild { id: string; name: string; emoji: string; color: string }

/**
 * Opening the library. With no options it is the device's library (welcome screen, picker, guest): its "Continue"
 * place lives in this browser. Opened for a child, it uses and updates that child's own place instead (`last`,
 * `onPlace`: the child's synced `settings.libraryPlace`), and `at` opens straight at a mishnah.
 */
export interface OpenLibraryOptions {
  child?: LibraryChild;
  /** The child's last place (null: none yet). */
  last?: ReadPlace | null;
  /** Called with each mishnah the child opens. */
  onPlace?: (place: ReadPlace) => void;
  /** Open at this mishnah instead of the library home. */
  at?: ReadPlace;
}

export type OpenLibrary = (opts?: OpenLibraryOptions) => void;

/**
 * Opens the library from anywhere in the signed-in or guest app, without threading a callback through every screen.
 * App provides it; null where there is no library to open (e.g. the public landing pages).
 */
export const OpenLibraryContext = createContext<OpenLibrary | null>(null);

export const useOpenLibrary = (): OpenLibrary | null => useContext(OpenLibraryContext);

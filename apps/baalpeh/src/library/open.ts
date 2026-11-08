import { createContext, useContext } from "react";

/**
 * Opens the library from anywhere in the signed-in or guest app ("📚 Library" buttons), without threading a callback
 * through every screen. App provides it; null where there is no library to open (e.g. the public landing pages).
 */
export const OpenLibraryContext = createContext<(() => void) | null>(null);

export const useOpenLibrary = (): (() => void) | null => useContext(OpenLibraryContext);

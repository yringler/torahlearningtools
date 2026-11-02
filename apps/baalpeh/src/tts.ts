// Read-aloud via the browser's Web Speech API.
//
// Why this is more than `speechSynthesis.speak(u)`: the API fails silently in several ways.
// - getVoices() is empty until the async `voiceschanged` event (Chrome), so voices must be awaited.
// - With no Hebrew voice installed (common on desktop Chrome/Windows), the default English voice
//   gets the text, skips every non-Latin character, and "speaks" nothing — no error, no sound.
// - iOS Safari only speaks when speak() runs synchronously inside the tap handler.
// - In Chrome, a paused engine queues forever, and a speak() after an idle cancel() can be dropped.
// - Failures surface only as an `error` event on the utterance, never as a thrown exception.

let hebrew: SpeechSynthesisVoice | null = null;
let voicesReady: Promise<SpeechSynthesisVoice[]> | null = null;
// Hold the active utterance so Chrome can't garbage-collect it mid-speech (which kills its events).
let current: SpeechSynthesisUtterance | null = null;

export const ttsAvailable = (): boolean =>
  typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";

function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  const now = speechSynthesis.getVoices();
  if (now.length > 0) return Promise.resolve(now);
  voicesReady ??= new Promise((resolve) => {
    const done = () => {
      speechSynthesis.removeEventListener("voiceschanged", done);
      clearTimeout(timer);
      voicesReady = null; // empty result: retry on the next tap rather than caching "none"
      resolve(speechSynthesis.getVoices());
    };
    const timer = setTimeout(done, 1500); // some engines (Safari) never fire voiceschanged
    speechSynthesis.addEventListener("voiceschanged", done);
  });
  return voicesReady;
}

function findHebrew(vs: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  // "he" is the current code; "iw" is the legacy one some Android engines still report.
  return vs.find((v) => /^(he|iw)\b/i.test(v.lang)) ?? null;
}

/** Start loading voices early so the first tap can speak synchronously. */
export function warmUpTts(): void {
  if (!ttsAvailable() || hebrew) return;
  void loadVoices().then((vs) => {
    hebrew ??= findHebrew(vs);
  });
}

/**
 * Speak Hebrew text. Resolves to null on success, or a user-facing message explaining why nothing
 * was heard. Approximate: device voices use modern Israeli pronunciation and may ignore nikud.
 *
 * Call it directly from a click handler: iOS Safari only allows speech started synchronously within
 * a user gesture, so the common path (voices already loaded) has no `await` before speak().
 */
export async function speak(text: string): Promise<string | null> {
  if (!ttsAvailable()) return "Read-aloud isn't supported in this browser.";
  hebrew ??= findHebrew(speechSynthesis.getVoices());
  if (!hebrew) hebrew = findHebrew(await loadVoices());
  const voice = hebrew;
  if (!voice) {
    return "No Hebrew voice is installed on this device. Add Hebrew in your device's text-to-speech / language settings, then reload.";
  }

  const synth = speechSynthesis;
  // Only cancel when something is queued: Chrome can drop a speak() issued right after an idle cancel().
  if (synth.speaking || synth.pending) synth.cancel();
  if (synth.paused) synth.resume();

  const u = new SpeechSynthesisUtterance(text);
  u.voice = voice;
  u.lang = voice.lang;
  u.rate = 0.75;
  current = u;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (msg: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      resolve(msg);
    };
    u.onstart = () => finish(null);
    u.onend = () => {
      if (current === u) current = null;
      finish(null);
    };
    u.onerror = (e) => {
      if (current === u) current = null;
      // "interrupted"/"canceled" = the user tapped play again; not a failure.
      if (e.error === "interrupted" || e.error === "canceled") finish(null);
      else if (e.error === "not-allowed") finish("The browser blocked audio. Tap the button again.");
      else finish(`Read-aloud failed (${e.error}).`);
    };
    const watchdog = setTimeout(
      () => finish("Read-aloud didn't start. Check that your device volume is on and try again."),
      4000,
    );
    synth.speak(u);
  });
}

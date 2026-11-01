let voice: SpeechSynthesisVoice | null | undefined;

function hebrewVoice(): SpeechSynthesisVoice | null {
  if (voice !== undefined) return voice;
  const vs = typeof speechSynthesis !== "undefined" ? speechSynthesis.getVoices() : [];
  voice = vs.find((v) => v.lang.toLowerCase().startsWith("he")) ?? null;
  return voice;
}

export const ttsAvailable = (): boolean => typeof speechSynthesis !== "undefined";

/** Approximate: device voices use modern Israeli pronunciation and may ignore nikud. */
export function speak(text: string): void {
  if (!ttsAvailable()) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "he-IL";
  u.rate = 0.75;
  const v = hebrewVoice();
  if (v) u.voice = v;
  speechSynthesis.speak(u);
}

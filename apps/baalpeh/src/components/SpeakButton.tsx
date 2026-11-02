import { useEffect, useState } from "react";
import { speak, warmUpTts } from "../tts";

interface Props {
  text: string;
  className: string;
}

/** 🔊 button that reads `text` aloud and shows why when nothing could be played. */
export function SpeakButton({ text, className }: Props) {
  const [error, setError] = useState<string | null>(null);
  useEffect(warmUpTts, []);
  const onClick = () => {
    setError(null);
    void speak(text).then(setError);
  };
  return (
    <>
      <button type="button" className={className} onClick={onClick} aria-label="Play" title="Approximate pronunciation">
        🔊
      </button>
      {error && (
        <p className="hint tts-error" dir="ltr" role="status">
          {error}
        </p>
      )}
    </>
  );
}

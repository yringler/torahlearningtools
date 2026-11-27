import { describe, expect, it } from "vitest";
import { inAndroidApp } from "../src/androidApp";

describe("inAndroidApp", () => {
  it("is true for the wrapper's WebView user agent", () => {
    expect(inAndroidApp("Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0 Mobile Safari/537.36 TorahLearningToolsAndroid/1.0.1")).toBe(true);
  });
  it("is false for Chrome on Android and for desktop browsers", () => {
    expect(inAndroidApp("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36")).toBe(false);
    expect(inAndroidApp("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36")).toBe(false);
  });
});

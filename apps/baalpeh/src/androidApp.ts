/** The Google Play listing of the Android wrapper app (`apps/android`, flavor `baalpeh`). */
export const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.torahlearningtools.byheart";

/** The wrapper's WebView appends this to its user agent (`MainActivity.kt`). */
const WRAPPER_UA_MARKER = "TorahLearningToolsAndroid/";

/** True inside the Android app itself, where a link to install it makes no sense. */
export function inAndroidApp(userAgent: string = typeof navigator === "undefined" ? "" : navigator.userAgent): boolean {
  return userAgent.includes(WRAPPER_UA_MARKER);
}

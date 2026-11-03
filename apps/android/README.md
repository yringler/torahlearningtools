# Android wrapper apps

A tiny Android app that shows one of the web apps full screen in a WebView. There is one product flavor per web app:

- `flashcards`: Word Quiz (`apps/cheder-flashcards`)
- `baalpeh`: Mishnah Ba'al Peh (`apps/baalpeh`)

It is a WebView and not a TWA so that Family Link counts it as its own app rather than as Chrome.
All the code is in `app/src/main/java/com/torahlearningtools/wrapper/MainActivity.kt`.
Per-flavor name, colors and icons are in `app/src/<flavor>/res`.

## Build

Needs JDK 17+ and the Android SDK (`ANDROID_HOME`, or `sdk.dir` in `local.properties`).

```sh
./gradlew assembleFlashcardsDebug   # app/build/outputs/apk/flashcards/debug/*.apk
./gradlew assembleBaalpehDebug
./gradlew lintFlashcardsDebug lintBaalpehDebug
```

Debug builds use the package suffix `.debug`, so they can be installed next to the Play version.
For signed release bundles and publishing, see `.github/workflows/android.yml` and `docs/android-play-setup.md`.

## Rules

- Never change an `applicationId` once the app is on Play. A new id is a new app.
- Pages on the flavor's own `https` host load in the app. Everything else (other sites, `mailto:`) opens in other apps.

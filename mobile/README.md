# REEF mobile (Android)

Capacitor shell that loads the deployed REEF web app (`https://reef-joe-d0a1.vercel.app`).
Override with `REEF_WEB_URL` before `npx cap sync`. `www/offline.html` shows when there is no signal.

## Build
1. `npm install`
2. `npx cap sync android`
3. `npx cap open android`, then Build > Build APK(s) in Android Studio
   (or `cd android && gradlew.bat assembleDebug` -> `android/app/build/outputs/apk/debug/app-debug.apk`).

`android/local.properties` (SDK path) is machine-specific and git-ignored; Android Studio creates it.

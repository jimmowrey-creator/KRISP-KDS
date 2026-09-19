# KRISP current release source

This directory is the maintained Build 7+ release source. The older Android folders are historical and are not the current build target.

`web/krisp-core.js` contains the order reconciliation corrections through Build 6 and the guarded Precheck-to-kitchen removal match. `src/` contains the updater. `version.json` controls the next release's increasing Android version code, tag and filename. `test/` includes the receipt regressions and an Android installer test.

The native receiver, Epson discovery and StationSync in the proven Build 4 APK are retained as immutable binary dependencies. `tools/build.py` fetches no arbitrary source or compiler plugin: it requires the exact SHA-256-verified Build 4 APK and preserves both original DEX files and all original resources. It adds a separate updater DEX and updates the manifest, settings page and reconciliation script. The Activity stub under `stubs/` is compile-time-only and is never packaged. Do not rebuild the old Build 3 source to release a correction.

## Corrections and releases

1. Change the code here and add a receipt or updater regression test.
2. Increment `versionCode` and update versionName/buildLabel/tag/fileName in `version.json`. Never reuse a published version code or tag.
3. Commit to main. The **KRISP tested updates** Actions workflow builds and tests the signed APK, including installation of a higher-version test candidate on an isolated Android 35 emulator. This candidate is not published.
4. After review, run the workflow with **publish** checked. It reruns the checks, publishes the APK, verifies its download hash and updates root `update.json`. A failed check prevents publishing.
5. On each tablet: **Settings → Check for updates → Download → Install**, then confirm Android's Update prompt. Android may first require allowing updates from KRISP. No QR code is needed after the updater-enabled build is installed.

The signing key belongs only in the encrypted Actions secret `KRISP_SIGNING_KEY` (base64 PKCS12), with passwords in `KRISP_STORE_PASSWORD` and `KRISP_KEY_PASSWORD`. Do not commit keys, tokens or passwords. The build checks that its signer matches Build 4. GitHub Actions permissions are limited to this repository.

## Installation and rollback

Package ID remains `com.krisp.kdsb4`; installed orders/settings persist. The launcher name and native green status bar still identify B4 because the frozen native code/resources are preserved. The page header and updater version identify the current build.

Builds 4, 5 and 6 remain in the v0.3.1 release. Build 7 uses versionCode 37, so Android's normal installer will not directly downgrade to older versionCode 34 APKs. For a production rollback, publish the last known-good web/updater code with a new higher versionCode and release tag. Do not uninstall the app to roll back, because that deletes stored orders/settings.

## Local build

With JDK 17, Node 22, Python 3.12, Android SDK platform 35 and build-tools 35.0.0:

```text
python updater/tools/build.py --baseline /path/Build4.apk --sdk /path/android-sdk --java /path/jdk17 --keystore /private/path/signing.p12
```

Provide passwords through the two environment variables named above. Omitting --keystore creates an unsigned test artifact only. Production publishing requires a signed artifact and passing Android installer evidence.

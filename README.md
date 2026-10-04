# Task Dashboard

A Tauri v2 desktop app for macOS and Windows. A single column of large buttons opens webmail in the browser you choose. Settings lets you add, edit, delete, and reorder buttons. Includes Outlook (work/school), Hotmail (personal Outlook), Gmail, and custom HTTPS webmail addresses.

## Develop

Install Node.js 24+ and Rust stable, plus the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/) (Xcode Command Line Tools on macOS; Microsoft C++ Build Tools and WebView2 on Windows).

```sh
npm ci
npm run tauri dev
```

The app was bootstrapped with the official [Tauri v2 starter](https://v2.tauri.app/start/) using `npm create tauri-app@latest . -- --template react-ts --manager npm --identifier com.hedwig.taskdashboard --yes`.

`npm run test:e2e` runs browser smoke tests using installed Google Chrome and a dedicated test server on port 1438.

`npm run dev` provides a UI preview with separate browser-local settings. Browser launching requires the desktop app.

## Use

Click a dashboard button to open its webmail address. In **Settings**, choose **Add button**, set a clear name, select an email environment (or enter a custom HTTPS address), and choose a browser. Save the button. Edit and delete existing buttons, or use the arrows to reorder them. An empty dashboard is supported.

Chrome, Edge, and Firefox must be installed; Safari is available on macOS. System default uses your OS browser preference. macOS locates named browsers through Launch Services; Windows uses registered App Paths for the current user and machine, including both registry views. Missing browsers produce an error. The app uses your existing browser session and never stores email credentials.

Settings are written atomically to a stable per-user directory, separate from the installed application and Tauri’s bundle-ID app data: `~/Library/Application Support/com.hedwig.taskdashboard.settings/settings.json` on macOS, and `%APPDATA%\com.hedwig.taskdashboard.settings\settings.json` on Windows. Replacing the macOS app or reinstalling/upgrading the Windows app under the same OS user preserves these settings, including names, browser choices, URLs, and button order. The Windows uninstaller’s optional bundle-data cleanup does not target this directory. Failed saves leave the previous dashboard intact; unreadable or invalid settings report an error instead of overwriting the file. No cloud account is required.

On first launch after upgrading from the initial version, existing `com.hedwig.taskdashboard/settings.json` settings are copied automatically to the new directory. The old file is retained for rollback; an existing new settings file always takes precedence. Install the first upgrade over the existing app and launch it once before removing any legacy app data. Settings already deleted manually or by the old uninstaller cannot be recovered automatically.

The settings directory name is a persistence contract: do not change it with a version, product name, or bundle identifier update. Future settings schema changes must migrate older versions; unsupported or corrupt files currently produce an error and are left intact. Installers must never package or remove the persistent directory. To deliberately reset settings, quit the app and remove both the persistent and legacy settings files (otherwise legacy settings will migrate again).

Actions use a tagged `type` field, currently `webmail`, so future actions can add independent configuration and launch logic. See `src/model.ts` and `src-tauri/src/lib.rs`.

## Verify and build

```sh
npm run build
npm run test:e2e
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
npm run tauri build
```

Installers are written to `src-tauri/target/release/bundle/`. Build each platform on that platform.

## GitHub releases

The [release workflow](.github/workflows/release.yml) follows [Tauri's GitHub Actions guidance](https://v2.tauri.app/distribute/pipelines/github/). Push the repository to GitHub, then run the workflow manually or push a version tag:

1. Update the matching versions in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`; refresh both lockfiles.
2. Commit the changes and push a tag such as `v0.1.0`.
3. Actions builds Apple Silicon and Intel macOS `.dmg`/app bundles and Windows x64 `.exe` (NSIS) / `.msi` installers, attaching them to a **draft GitHub release**.
4. Review the artifacts and publish the draft release in GitHub.

The workflow needs GitHub Actions enabled and its built-in token allowed to write repository contents. No signing secrets are needed for this initial pipeline. macOS uses ad-hoc signing, without notarization; Windows installers are unsigned, so operating systems may show trust prompts. For public distribution, configure [macOS signing and notarization](https://v2.tauri.app/distribute/sign/macos/) and [Windows signing](https://v2.tauri.app/distribute/sign/windows/) with your certificates and GitHub secrets.

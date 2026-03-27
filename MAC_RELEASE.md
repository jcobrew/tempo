# macOS Release Checklist

## 1) Build local unsigned app

```bash
npm run pack:mac
```

Output app bundle:

- `release/mac-arm64/Tempo.app`

## 2) Build distributable artifacts (DMG + ZIP)

```bash
npm run dist:mac:arm64
```

Output artifacts:

- `release/Tempo-<version>-arm64.dmg`
- `release/Tempo-<version>-arm64-mac.zip`

If you want screenshot strict beta to work in the shipped app, make sure the packaged build also has the correct frontend env vars at build time and that the backend is already deployed.

## 3) Enable notarization (recommended for end users)

Set environment variables before `dist` builds:

```bash
export APPLE_ID="your-apple-id@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="TEAMID1234"
```

Then run:

```bash
npm run dist:mac:arm64
```

Notarization is skipped automatically if these variables are not present.

## 4) Recommended next polish before public release

- Add app icon at `build/icon.icns` and configure it in the `build.mac.icon` field in `package.json`.
- Replace placeholder author and app metadata in `package.json`.
- Test install/open flow on a clean macOS user account.
- Verify strict beta onboarding, sign-in, and screen-permission flow on a clean Mac account.

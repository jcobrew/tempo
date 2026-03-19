# macOS Release Checklist

## 1) Build local unsigned app

```bash
npm run pack:mac
```

Output app bundle:

- `release/mac-arm64/Reactive Timer.app`

## 2) Build distributable artifacts (DMG + ZIP)

```bash
npm run dist:mac:arm64
```

Output artifacts:

- `release/Reactive Timer-<version>-arm64.dmg`
- `release/Reactive Timer-<version>-arm64.zip`

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

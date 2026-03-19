# Release Tonight

## Goal

Get Reactive Timer into users' hands tonight with:
- a downloadable macOS build,
- a public repository people can inspect or improve,
- a simple feedback loop that produces useful product signal fast.

## 1. Build A Shareable App

From the project root:

```bash
npm run dist:mac:arm64
```

Expected output:
- `release/Reactive Timer-0.1.0-arm64.dmg`
- `release/Reactive Timer-0.1.0-arm64.zip`

If notarization credentials are not configured, the build can still complete, but users may see extra macOS warnings on first open.

## 2. Recommended Same-Night Distribution

Fastest path:
1. Upload the `.dmg` and `.zip` to Google Drive, Dropbox, Gumroad, or GitHub Releases.
2. Share one short message with:
   - what the app does,
   - that it is macOS-only for now,
   - that it is an early build,
   - where to send feedback.

Best public repo path:
1. Create a new GitHub repo named `reactive-timer`
2. Push this folder
3. Create a GitHub Release
4. Attach the `.dmg` and `.zip`

## 3. GitHub Setup

Initialize the repo locally:

```bash
git init
git add .
git commit -m "Initial public release"
```

Then create the GitHub repository and connect it:

```bash
git remote add origin <your-github-repo-url>
git branch -M main
git push -u origin main
```

## 4. What To Tell Testers

Suggested short message:

> I built a small macOS focus app called Reactive Timer. It gives you a floating timer, nudges while you work, and local-only session history. This is an early build and I want honest feedback on what feels useful, confusing, or not worth keeping.

Ask them to answer:
1. What task did you try it with?
2. What felt immediately useful?
3. What felt confusing or annoying?
4. Would you keep the floating timer on while working?
5. What one thing should be improved first?

## 5. Best Feedback Channels For Tonight

Pick one:
- GitHub Issues
- a Google Form
- a Notion form
- direct DM replies if the tester count is small

If using GitHub Issues, point people to:
- bug reports for broken behavior
- feedback discussions for product thoughts

## 6. What To Be Transparent About

Say this clearly:
- macOS only
- early build
- UI still evolving
- strict mode is early and best-effort
- local-first privacy approach

## 7. Nice-To-Have But Not Required Tonight

- app icon at `build/icon.icns`
- notarized build
- landing page
- analytics
- auto-updates

None of those should block getting the app in front of real users tonight.

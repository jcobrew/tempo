# Tempo

Tempo is a small macOS desktop app for focused work.

It combines:
- a lightweight focus queue,
- a floating mini timer,
- contextual nudges while a task is active,
- optional strict mode with allowlisted apps/sites,
- local-only history and reflections.

The current build is optimized for quick local testing and early feedback from macOS users.

## What It Does

- Add a task from one line, like `Write landing page copy for 25 min`
- Start a focus session immediately
- Keep a separate mini timer window floating above other apps
- Show supportive nudges while you work
- Offer extra time near the end of a session
- Save focus history locally on-device
- Optionally enable strict mode to watch for context drift

## Current Status

This is an early public build.

What is solid:
- Local macOS desktop app shell
- Floating mini timer
- Focus queue and history
- Notification-style nudges
- Local-only storage

What is still evolving:
- Visual polish across all states
- Music integration UX
- Strict mode reliability across different browser/app combinations
- Release packaging polish like app icon and notarized distribution

## Run Locally

Requirements:
- Node.js 20+ recommended
- macOS for the desktop build

Install and run:

```bash
npm install
npm run dev:desktop
```

Build the app:

```bash
npm run build
```

Create a local macOS app bundle:

```bash
npm run pack:mac
```

Create distributable artifacts:

```bash
npm run dist:mac:arm64
```

## Feedback Wanted

The most useful feedback right now:
- Does the mini timer feel helpful or distracting?
- Are the nudges motivating or annoying?
- Is the task-entry flow obvious?
- Does the music behavior feel lightweight enough?
- Is strict mode understandable and trustworthy?
- Which parts feel unfinished or confusing?

If you share this build tonight, ask testers for:
- macOS version
- whether notifications were enabled
- what they were trying to do
- what broke or felt awkward
- one feature they actually wanted to keep using

## Privacy

Tempo is built around local-first storage.

Current behavior:
- task history is stored locally
- reflections are stored locally
- strict mode does not store screenshots or OCR logs

## Open Source

This repository is available for improvement and experimentation under the MIT license.

If you contribute, focus on:
- UI clarity
- smaller, reliable iterations
- macOS-specific polish
- strict mode guardrails and trust

## Tonight's Shipping Guide

Use the checklist in [RELEASE_TONIGHT.md](/Users/eigengrau/Desktop/tempo/RELEASE_TONIGHT.md).

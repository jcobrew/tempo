# Tempo

Tempo is a small macOS desktop app for focused work.

It combines:
- a lightweight focus queue,
- a floating mini timer,
- contextual nudges while a task is active,
- optional screenshot-based strict mode beta,
- local-only history and reflections.

The current build is optimized for quick local testing and early feedback from macOS users.

## What It Does

- Add a task from one line, like `Write landing page copy for 25 min`
- Start a focus session immediately
- Keep a separate mini timer window floating above other apps
- Show supportive nudges while you work
- Offer extra time near the end of a session
- Save focus history locally on-device
- Optionally enable strict beta to analyze periodic screenshots for context drift

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
- Strict beta accuracy, latency, and trust UX
- Release packaging polish like app icon and notarized distribution

## Run Locally

Requirements:
- Node.js 20+ recommended
- macOS for the desktop build

Install and run the desktop app:

```bash
npm install
cd backend && npm install && cd ..
cp .env.example .env
cp backend/.env.example backend/.env
npm run dev:desktop
```

The screenshot strict beta requires:
- `VITE_TEMPO_API_BASE_URL`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- backend env vars in `backend/.env`

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
- strict beta screenshots are captured only during active strict sessions
- strict beta screenshots are sent to the Tempo backend for Gemini analysis
- screenshots are not retained by default
- the Gemini API key never ships in the app

Read the stricter disclosure in [PRIVACY.md](/Users/eigengrau/Desktop/tempo/PRIVACY.md).

## Open Source

This repository is available for improvement and experimentation under the MIT license.

If you contribute, focus on:
- UI clarity
- smaller, reliable iterations
- macOS-specific polish
- strict beta guardrails and trust

## Tonight's Shipping Guide

Use the checklist in [RELEASE_TONIGHT.md](/Users/eigengrau/Desktop/tempo/RELEASE_TONIGHT.md).

# Tempo Privacy Notes

Tempo is local-first by default.

## Stored on your Mac

- task queue
- focus history
- reflection notes
- local UI preferences

## Screenshot Strict Beta

Strict beta is optional and off by default.

When you enable it:
- Tempo asks for Screen Recording permission on macOS
- Tempo captures periodic screenshots only while a strict session is active
- screenshots are sent to the Tempo backend for Gemini analysis
- screenshots are not retained by default after analysis
- Tempo stores only lightweight session metadata needed for product safety, billing control, and abuse prevention

Tempo does not ship any Gemini API key or other private AI credential in the desktop app.
Tempo also does not ship any Supabase secret key in the desktop app.

## Accounts

Strict beta requires account sign-in so Tempo can:
- rate-limit usage
- protect backend resources
- associate a strict session with the correct user

## Current Scope

Tempo does not use OpenAI APIs or consume OpenAI credits.

The direct-download build may include experimental features that are not available in an App Store build.

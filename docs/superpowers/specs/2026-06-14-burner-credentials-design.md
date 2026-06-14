# Burner Credentials — Design (Phase 2)

**Date:** 2026-06-14
**Status:** Approved (design), depends on Popup Zapper v1
**Relationship:** A separate module that reuses Popup Zapper's wall detection.
Build after v1 ships.

## Problem

Some pages gate content behind "create any account to continue". The user wants
to view the content without exposing a trackable identity or reusing credentials
that can be correlated across sites.

## Goal

A one-click **burner signup** on a detected login/signup wall that generates an
untrackable, per-site identity, autofills the form, and stores the credentials so
the user can log back in later.

Untrackability comes from two things:

1. **Per-site random username + strong random password** — no cross-site reuse,
   nothing to correlate.
2. **Email alias** — a throwaway address (DuckDuckGo Email Protection,
   SimpleLogin, addy.io, Firefox Relay, Apple Hide-My-Email) that forwards to the
   real inbox. The site never sees the real address; the alias can be burned.

## Chosen approach: alias service + human-completed verification

- Script generates `{ username, password, aliasEmail }` and **autofills** the
  signup form.
- **User completes** any CAPTCHA, submits, and clicks the verification link that
  arrives in their real inbox via the alias.
- Rationale: fully automating inbox reading + verify-click is fragile, needs
  inbox API access, trips bot detection, and raises ToS issues. Human-in-the-loop
  for CAPTCHA + verify is robust and low-risk while still saving all the tedium.

## Components

### Identity generator (pure)

- `username`: pronounceable random or random string (configurable pattern).
- `password`: strong random (length + character classes configurable).
- `aliasEmail`: produced by the configured alias strategy (see below).
- Unit-testable, no DOM/network.

### Alias strategy (pluggable)

User configures one strategy once. Options, in order of automation:

- **Catch-all / plus-addressing** (`you+sitename@yourdomain` or
  `you+sitename@gmail`) — zero setup if the user has a catch-all domain; weak
  untrackability (real address visible) but no third party.
- **DuckDuckGo Email Protection** (`@duck.com` aliases) — strong, free.
- **SimpleLogin / addy.io** — API can mint a fresh alias per site if the user
  supplies a token; otherwise the user pastes a pre-made alias.

The strategy returns an email string; how it is obtained (template vs. API call)
is encapsulated behind one interface.

### Form filler

- Reuses Popup Zapper's wall detection to know a signup form is present.
- Locates fields by heuristics: `input[type=email]`, `input[type=password]`,
  username/`name` fields, password-confirm fields, and dispatches proper
  `input`/`change` events so framework-backed forms register the values.
- Does **not** auto-submit by default (avoids CAPTCHA/bot-detection failures);
  a config flag can enable auto-submit for tolerant sites.

### Credential vault

- Stores `{ domain, username, password, aliasEmail, createdAt }` in GM storage,
  encrypted-at-rest behind a user passphrase (Web Crypto `subtle`,
  passphrase-derived key; never store the passphrase).
- Export/import as an encrypted file.
- **Password-manager handoff (preferred):** because browser/Bitwarden managers
  detect the filled fields, saving can be left to the manager; the built-in
  vault is the fallback for users without one.
- A "show credentials for this site" panel for logging back in.

## Controls

- A **"Burner signup"** action appears in the manage panel / context badge when a
  signup wall is detected. Optional hotkey `Alt+Shift+B`.

## Safety, limits, non-goals

- **CAPTCHA and email verification are user-completed** — by design.
- **ToS:** throwaway accounts violate some sites' terms; intended for personal
  read-access only. Surface a one-time notice.
- **Non-goal:** mass/automated account creation, defeating CAPTCHAs, or reading
  inboxes automatically.
- All field detection wrapped so a failed match never breaks the page.

## Testing approach

- Unit tests for identity generator and alias-template strategy.
- Field-detection tested against saved signup-form fixtures.
- Vault encrypt/decrypt round-trip tests.
- Manual checklist on a few real signup walls.

## Dependencies

- Popup Zapper v1 (wall detection, manage panel, GM storage conventions).
- Optional: user-configured alias service account/token.
import type { DocPayload } from "../types";

export const SAMPLE_DOC: DocPayload = {
  name: "Pulse v1 — Async Standup PRD.md",
  content: `# Pulse v1 — Async Standup PRD

> Status: \`Draft 4\` · Owner: @jamie · Last edited: 2026-05-09

Pulse is a lightweight tool for distributed teams to share what they're working on without scheduling another meeting. This PRD covers the v1 release: a focused, single-channel product that ships in 6 weeks.

## Context

Engineering surveyed 412 employees in March; **68% described their team's standups as "low signal"** and the median attendee multitasks during 71% of the call. Pulse replaces the live call with an async thread that takes ~90 seconds to post and ~3 minutes to read for the whole team.

We are **not** building a general-purpose chat tool. We're solving exactly one workflow — the daily standup — and everything else is out of scope for v1.

## Goals

The v1 release is successful if, 30 days after launch:

- 70% of pilot teams have replaced at least 3 of their 5 weekly live standups with Pulse threads
- Median time to post a Pulse is under 90 seconds
- Read-rate of teammate Pulses is above 80% per team per day
- NPS from team leads is at least +30

### Non-goals

- General team chat (Slack/Teams remains the social channel)
- Calendar integration beyond a single "remind me at X" hook
- Native mobile app — mobile web is sufficient for v1
- Cross-team aggregation dashboards (post-v1)

## User stories

As a **team member**, I want to write my Pulse from a single screen in under two minutes so that I don't lose flow time.

As a **team lead**, I want to see who has and hasn't posted today so that I can nudge without nagging the whole team.

As a **new hire**, I want to read the last week of Pulses so that I can catch up on what my team has been doing.

## Functional requirements

### Posting a Pulse

A Pulse is composed of exactly three fields:

| Field | Required | Max length | Notes |
|---|---|---|---|
| Yesterday | yes | 280 chars | What you actually finished. Not a to-do list. |
| Today | yes | 280 chars | The single most important thing. |
| Blockers | no | 500 chars | Anything where you need help from a teammate. |

The composer uses a single-column form with autosave every 5 seconds. Drafts persist across sessions. We do **not** support rich formatting in v1 — plaintext + URL autolinking only.

### Reading Pulses

The team view shows the day's Pulses as a stacked list, newest at the top. Each card shows the author, their three fields, and an emoji reaction tray. Reactions are limited to four canonical glyphs: 👀 (seen), 👍 (looks good), 🤔 (have questions), 🙋 (can help).

Anyone can reply, but replies are threaded under the card and collapsed by default. The card surfaces only the reply count and the first reactor's avatar.

### Reminders and digests

Each team configures a single posting window — e.g. "9:00–11:00 local time". If a member has not posted by the close of their window, they get one nudge. Exactly one. We never send a second.

At the end of the window, a digest is posted to the team's chosen Slack channel:

\`\`\`yaml
digest:
  posted: 7
  pending: 2
  blockers: 1
  top_emoji: 👀
  link: pulse.app/t/eng-platform/2026-05-12
\`\`\`

## API

The MVP exposes three endpoints under \`/api/v1\`:

- \`POST /pulses\` — create or update today's Pulse for the authenticated user
- \`GET /teams/:id/pulses?date=YYYY-MM-DD\` — fetch a day's Pulses for a team
- \`POST /pulses/:id/reactions\` — add or remove a reaction

All endpoints accept and return JSON. Authentication is via the existing workspace SSO cookie; no new auth surface.

## Open questions

- **Should blockers fan out as @mentions?** Engineering wants this; design is worried about noise. Decision needed by **2026-05-15**.
- How do we handle PTO? Auto-skip with a calendar integration, or a manual "I'm out" toggle?
- What is the right behavior when a team member belongs to two teams? Post twice, or post once and show in both?

## Milestones

- **Week 1–2:** API + data model, Pulse composer
- **Week 3–4:** Team view, reactions, threaded replies
- **Week 5:** Reminders, Slack digest
- **Week 6:** Internal dogfood across 8 pilot teams, bug bash, ship

## Appendix: rejected alternatives

We considered three other shapes for this product:

1. **Video standup recordings.** Rejected — too high a posting cost; defeats the "90 seconds" goal.
2. **Repurposed Slack channel with a bot.** Rejected — every team we surveyed had already tried this and abandoned it within a month.
3. **AI-summarized standups from Linear/Jira activity.** Rejected for v1 — too much variance in how teams actually use those tools.
`,
};

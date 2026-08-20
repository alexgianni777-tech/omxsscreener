---
name: Earnings Calendar Dates
description: Calendar-day handling for Yahoo earnings timestamps in screener and EdgeAI imports.
---

## Rule

Treat a Yahoo earnings timestamp as a calendar event. Compare the UTC calendar
date components of the event and reference date; do not round a raw elapsed-hour
difference.

**Why:** Yahoo sends a time of day for many earnings events. An after-close
event on the current date can be 20:00 UTC, and rounding its elapsed time from
UTC midnight incorrectly turns “today” into “tomorrow”.

**How to apply:** Use the shared market-calendar helper for the earnings
screener, EdgeAI imports, scheduler imports, and any future Rule 7 report-date
calculation. Keep imported historical-session dates relative to that session's
calendar date rather than the later viewing date.
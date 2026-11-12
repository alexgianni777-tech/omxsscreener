---
name: Nav isActive Gotcha
description: startsWith matching in layout.tsx conflicts when one nav href is a prefix of another (e.g. /sessions vs /sessions/today).
---

## The problem

`layout.tsx` uses this pattern:
```js
const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
```

When `/sessions/today` is added as a nav item alongside `/sessions`, being on `/sessions/today` makes BOTH highlight as active because `"/sessions/today".startsWith("/sessions")` is true.

## The fix (applied)

```js
const isActive =
  location === item.href ||
  (item.href !== "/" &&
    location.startsWith(item.href) &&
    // Prevent /sessions from matching /sessions/today (separate nav item)
    !(item.href === "/sessions" && location.startsWith("/sessions/today")));
```

**Why:** Always add an exclusion clause when adding a nav item whose href is a suffix of an existing one. General rule: if new href starts with an existing href, add an explicit exclusion for the parent.

## How to apply

Any time a new nav item is added whose path begins with an existing nav item's path, check for this conflict and add an exclusion in the `isActive` logic.

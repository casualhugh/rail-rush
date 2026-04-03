# UX Clarity Improvements

## 1. Challenge hint text
`ChallengeModal.tsx` — replace the existing hint paragraph (currently "Reveal this challenge to attempt it. You can only attempt one challenge at a time.") with:

"Reveal to claim this challenge for your team. You can only attempt one challenge at a time. Other teams are locked out while you attempt it. If your team fails, the reward grows for others, but you cannot retry."

## 2. Map legend
New `MapLegend` component rendered in `GameMap.tsx`. Floating card, bottom-left, positioned `bottom: 3.5rem; left: 1rem` (just above the ScorePanel toggle). `z-index: 10`. Defaults open on game load (`showLegend` state initialised to `true`).

Three rows, each with a miniature visual + label:
- Small white circle (16px, grey border) = "Unclaimed station"
- Small coloured circle (16px, teal fill) = "Owned by a team"
- Small amber rect with `▽` glyph (matching `.challengeBadge` style) = "Active challenge"

Close button (x) hides the card. `SlQuestion` button (import from `react-icons/sl`, already used in the project) renders in the same corner when legend is closed to reopen it.

## 3. Bell icon (already done by user)

## 4. Toll button gating
`StationModal.tsx` — inside the `isEnemy` block, disable the toll button when `myBalance >= minContest` and show note below: "Pay a toll once you no longer have enough coins to contest."

Also disable the toll button (no note needed) when `myBalance === 0` since `effectiveToll` would be zero — a zero-coin payment is meaningless.

Enabled as normal when `myBalance > 0 && myBalance < minContest`.

## 5. Confirmations for Mark Complete and Mark Failed
`ChallengeModal.tsx` — both buttons call `window.confirm` before proceeding (same pattern as `doMarkImpossible`):
- Complete: "Mark this challenge as complete? Make sure you have submitted proof before confirming."
- Failed: "Mark this challenge as failed? Your team will not be able to attempt it again."

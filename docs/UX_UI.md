# Tradenza — UX/UI Documentation

This document describes Tradenza from a product, design, and interaction standpoint: the design system, the navigation model, the core user flows, and the purpose of each screen. It is meant for designers, contributors, and anyone who wants to understand _why_ the app is shaped the way it is — not just how it is built. For the technical/architecture view, see the [README](../README.md).

---

## 1. Design philosophy

Tradenza is built for traders reviewing their performance, often at the end of a session when focus is low and emotions may be high. Three principles guide the design:

1. **Data over decoration.** Every screen leads with numbers that change behavior — P&L, win rate, expectancy, drawdown. Visual flourish never competes with the figure a trader is there to read.
2. **Calm, dark-first surface.** Trading screens are already loud. The default theme is a deep, low-contrast dark palette so that the only saturated colors on screen are _meaningful_ ones: green for profit, red for loss, blue for breakeven.
3. **Honesty.** The journal exists to confront a trader with reality. Losing days are shown as plainly as winning ones; discipline rules track what you actually did, not what you intended.

---

## 2. Design system

### Color tokens

Colors are defined as HSL CSS custom properties in [`src/app/globals.css`](../src/app/globals.css) and exposed to Tailwind in [`tailwind.config.js`](../tailwind.config.js). Components reference semantic tokens (`bg-card`, `text-muted-foreground`, `text-profit`) rather than raw colors, so both themes — and any future re-theming — stay consistent.

| Token                            | Dark value                       | Role                                      |
| -------------------------------- | -------------------------------- | ----------------------------------------- |
| `background`                     | very dark navy `#0e1117`         | App canvas                                |
| `card` / `popover`               | `#161c24`                        | Raised surfaces, panels, dialogs          |
| `primary`                        | emerald `#34d399`                | Primary actions, focus ring, brand accent |
| `secondary` / `muted` / `accent` | dark grays                       | Subtle surfaces, secondary text           |
| `border` / `input`               | `#272d38`                        | Hairlines, field outlines                 |
| `destructive`                    | red                              | Delete / dangerous actions                |
| **`profit`**                     | emerald                          | Positive P&L, winning days                |
| **`loss`**                       | red                              | Negative P&L, losing days                 |
| **`breakeven`**                  | blue                             | Scratch / breakeven outcomes              |
| `sidebar`                        | slightly lighter than background | Left navigation rail                      |

The trading-semantic colors (`profit` / `loss` / `breakeven`) are the heart of the system. They are applied consistently across every number, chart series, calendar cell, and badge so a trader learns to read the screen at a glance.

### Theming

A **dark theme** is the default. A **light theme** is available and toggled via the `ThemeProvider` adding a `.light` class to `<html>`; every token has a tuned light-mode counterpart (notably a darker, more legible primary green on white). The toggle lives in the UI as `ThemeToggle`.

### Typography

- **DM Sans** for all UI text — a clean, slightly geometric sans that stays legible at small sizes.
- **DM Mono** for monospaced contexts.
- **Tabular numerals** (`.tabular`, `font-variant-numeric: tabular-nums`) are used wherever figures align in columns or update in place, so digits never shift horizontally as values change.

### Shape, motion, and feedback

- **Radius:** a single `--radius` (0.5rem) base with `sm`/`md`/`lg` derivatives keeps corners consistent.
- **Motion:** restrained — `fade-in` (8px rise + opacity) for entering content, `slide-in` for the sidebar/sheet, and a `shimmer` for skeleton loaders. Nothing bounces or distracts.
- **Loading states:** nearly every route ships a dedicated `loading.tsx` skeleton (e.g. stat-card skeletons, skeleton tables) so navigation feels instant and layout never jumps when data arrives.
- **Toasts:** transient feedback (save, import result, errors) is delivered via Sonner, top-of-stack and auto-dismissing.
- **Confirmation:** destructive actions route through a shared `ConfirmProvider` dialog rather than native `confirm()`.

### Component layers

The UI is assembled from three layers:

1. **Primitives** (`src/components/ui/`) — Radix-based building blocks (Dialog, Select, Tooltip, Popover, Tabs, Switch) plus app-specific inputs (DateRangePicker, MultiSelect, ComboCreate, RichTextEditor, Pagination, ActionMenu).
2. **MUI** — used where its mature components add value, primarily date/time pickers, themed via `mui-theme.ts` to match the token palette.
3. **Feature components** — composed per domain: `dashboard/`, `trades/`, `stats/`, `progress/`, `strategies/`, `settings/`, `accounts/`, `trade-import/`.

---

## 3. Navigation model

### Structure

The app uses three route groups that map to three distinct contexts:

- **`(auth)`** — sign-in / sign-up. Minimal, centered, no app chrome.
- **`(app)`** — the authenticated product. Persistent left sidebar + global header.
- **`(wizard)`** — the focused, full-screen trade-import flow with its own minimal chrome (`WizardChrome`) so the user isn't distracted while mapping data.

### The persistent shell

Inside `(app)`, every screen shares:

- **Left sidebar** (`Sidebar`) — primary navigation: Dashboard, Trades, Statistics, Discipline, Strategies, Accounts, Settings, plus the prominent **Add trade** action. It can collapse (state held in `SidebarContext`) and has a subtle primary "glow".
- **Global header** (`AppHeader`) — app-wide controls that filter multiple screens at once:
  - **Account selector** — scope all data to one trading account or view all.
  - **Date range** — with quick presets (today, this week, month, etc.).
  - **Unit toggle** — display P&L in **$** or in **R** (risk multiples).
  - **Filters** — additional cross-cutting filters.
- **Mobile** — the sidebar collapses into a `MobileSheet` triggered from the header, so the same navigation works on small screens.

This shell is the backbone of the UX: a trader sets account + date range + unit once in the header, and the dashboard, trades and stats views all respect it.

> **Discipline is deliberately outside the global filters.** `/progress` is a record of _your_ process, not of a slice of trades: rules, schedules and daily check-ins belong to the trader, not to an account, and the year heatmap and streaks only make sense over an unbroken calendar. So the header's account, date-range and unit selections do **not** apply there — the page always shows the full history across every account. The one place this shows up as a caveat is the "does discipline pay off?" widget, which correlates day colour with the day's net P&L across all accounts; account-scoped correlation is a known gap.

---

## 4. Core user flows

### 4.1 First run / onboarding

```
Landing page → Sign up (Clerk) → Dashboard
```

The landing page (`/`) is a focused marketing page: a hero ("Improve your trades with data, not feelings"), a trust strip, a three-part showcase of real screens (dashboard, trade detail, discipline), a grid of supporting features, a four-step "how it works", the open-source pitch, an FAQ, and clear "Start free" CTAs. Authenticated users see "Go to dashboard" instead. After sign-up, the user lands on the dashboard with a sensible default layout and is prompted toward adding or importing trades.

### 4.2 Importing trades (the primary onboarding path)

```
Add trade / Import → Method (CSV vs manual) → Account → Broker → Upload CSV → Confirm → Trades
```

This is a deliberately **multi-step wizard** in its own route group so the user can concentrate:

1. **Method** — import from a CSV export, or enter a trade manually.
2. **Account** — pick (or create) the trading account the trades belong to.
3. **Broker** — choose the source format from a large broker catalog (`lib/brokers.ts`), which drives column mapping.
4. **Upload** — drag-and-drop the CSV (react-dropzone); rows are parsed (PapaParse) and validated.
5. **Confirm** — duplicates (matched on an external ID per user) are detected and skipped automatically; the result is written to import history.

Every import is logged (`import_logs`) with totals, skipped/error counts, and the created trade IDs, so it can be reviewed — or deleted — later from **Settings → Import history**.

### 4.3 Reviewing a single trade

```
Trades list → Trade detail [id]
```

The trade detail screen is the journaling heart of the app:

- **Price chart** (`TradeChart`, lightweight-charts) with the entry/exit marked. Candles are fetched on demand via Databento and cached in time chunks (`market_candle_chunks`); if no market-data key is configured, the chart degrades gracefully.
- **Executions / legs editor** — multi-fill and multi-leg trades are supported, with a **running P&L** chart as the position is built and reduced.
- **Stats panel** — per-trade metrics (R, hold time, fees, etc.).
- **Notes tabs** — structured journaling split into setup, emotions (before / after), mistakes, and lessons, with a rich-text editor and **autosave** (`useAutosave`).
- **Star rating** — a quick subjective grade of execution quality.
- **Tags panel** — assign tags and categories.
- **Strategy & adherence** — link the trade to one of your strategies, then work through the three adherence blocks (gate / setup / exit). Each block is explicitly **confirmed** when you're done with it, which is what admits it to the statistics; see §4.6.
- **Customizable sidebar** — a gear-menu (`SidebarSettings`, dnd-kit) lets the trader show, hide and drag-to-reorder every sidebar panel (running P&L, strategy, details, risk, tags) and individual stat row (R, ROI, MAE/MFE, entry/exit times, star rating…), with a one-click reset. Preferences are saved to the user's account (`SidebarPrefs`), so a review layout persists across trades and sessions rather than living in one browser.

The structure nudges the trader past "did I win?" toward "did I execute well, and what do I repeat or avoid?".

### 4.4 Daily discipline review

```
Discipline (Progress) → Day [date]
```

Separate from P&L, the **Discipline** area tracks _process_.

The area has three tabs — **Trading**, **Daily** and **Manage** — and two domains that share one model: trading rules score your execution, daily habits track how you show up. Both are defined the same way: a rule is a **task** you tick off or a **constraint** you must not break, it runs on its own weekday schedule, and it can be reordered, paused or archived. Archiving stops it applying from today while it keeps counting toward the days it governed, so history is preserved.

**Every change to a rule is forward-only — the past is a record, not a view.** Creating, archiving, pausing and _changing the schedule_ all take effect from the day they happen and leave every day behind them exactly as it was scored. Schedules used to be the exception: they lived in a single column read back over the whole history, so moving a habit from Mon–Fri to every day repainted a year of Saturdays as days you "missed", and narrowing it deleted verdicts you had actually earned — the heatmap, the streaks and the by-weekday breakdown all changed shape retroactively. Each superseded schedule is now kept as a closed segment (`progress_rule_schedules`), and every scorer reads the schedule that was in force on the day it is scoring. Pausing works the same way and for the same reason: a paused stretch is a stretch with nothing scheduled, so paused days stay excluded once they slide into the past instead of quietly resurfacing as misses. The one thing still locked after creation is the rule's **mode**, because that changes what every already-logged row _means_ rather than which days it applies to.

**Tasks vs. constraints — one model, both tabs.** Every rule is either a **task** you actively do (trading _soft_ / daily _building_) or a **constraint** you must not break (trading _hard_ / daily _avoidance_). A constraint is satisfied by default and is breached by _logging_ it, which has one consequence worth stating plainly: **constraints never count toward the day's `x/y` counter, the progress ring or any completion percentage.** Otherwise an untouched morning would already read "2/5 done" and a ring would fill itself overnight for doing nothing. Constraints live in their own section of the day panel, get their own summary line ("3 clean · 1 slipped") and their own column in the consistency breakdown — with a _clean/respect rate_ rather than a completion rate, because "stayed clean on 90% of days" and "did it on 90% of days" are not the same measurement and must not share a scale. What a constraint _does_ control is the day's colour, and a definitive breach zeroes the day's score so it can never hide inside a rolling average. The Trading and Daily tabs implement this identically (shared components: `DayRulesSections`, `ConsistencyList`, `aggregateHabitDayStatus`).

The two tabs differ in exactly one respect, deliberately: **how much a breach costs.** A trading hard rule reddens the day on the **first** breach — a blown risk limit has no "warning" tier. A daily avoidance habit follows _never miss twice_: one slip is amber, a slip on two consecutive scheduled days is red. One glass of wine is not a failed month; a blown max-daily-loss is a blown max-daily-loss. Both panels and the info tooltips spell this out at the point of use.

Because `ruleType` alone is ambiguous (`hard` means "instant red" on a trading rule and "never miss twice" on a habit), the UI never speaks in tiers. It speaks in **modes** — `strict`, `avoidance`, `building` — derived from `(type, category)` by `ruleModeOf`, and every mode is shown next to a **Constraint / Task** chip so the shared class is visible rather than implied. Storage is unchanged; the mode is a projection.

**Confirmed vs. unfilled.** A constraint is satisfied by default, so a user who never opens the app would score a perfect respect rate — fine as a colour, useless as evidence. A day is therefore **confirmed** only when the user engaged with it: ticked or flagged a rule, or marked the day reviewed. **"Does discipline pay off?" counts confirmed days only**, and says how many it left out. Ticking anything confirms a day implicitly, so the explicit "Mark day reviewed" button only appears where there's nothing to tick — a rule set made entirely of constraints. Confirmation deliberately does **not** gate the day's colour or the streaks.

**Excused days and the grace window.** Once unlogged days stopped distorting the numbers, the only thing left for an "I was away" marker to protect is the **streak** and the **coverage** denominator. So it isn't presented as a third kind of day: it's an unlogged day with a reason. It shares the hatch (tinted blue rather than grey), shares one legend entry, and the control says what it does — **"Don't count this day"** — instead of asserting a fact about the world.

**One flag, with a scope.** Being away is a fact about _you_, so it is one row on the calendar day and the default (`both`) excuses everything — the ordinary case stays a single click. But "away" and "not trading" are not the same thing, and a trader taking a week off the markets while still going to the gym had no way to say so. The excuse therefore carries a **scope** — _whole day_, _trading only_, _daily only_ — offered as a refinement _after_ the day is excused, never as a question asked before the user has made the first decision. Two independent booleans were rejected: they would make the common case cost two actions to serve the exception, and would let the two drift into states nobody meant.

Excusing a day removes the **obligation**, never the **record**: any evidence that you did turn up beats the flag, which self-negates rather than needing a corrective write. Crucially, that evidence is judged **per domain** — trading counts trades and ticked rules, habits count logged habits — and that is what makes one shared calendar-day flag safe across both tabs. A holiday is excused for trading and, if you kept your habits through it, still scored _and credited_ on the habits side. Without that split, marking a holiday would quietly delete work the user actually did.

Marking absence in advance is a fiction — nobody opens their trading journal from a hotel to tick a box. It's remembered at the moment the streak dies, so that's where the app offers it: when a contiguous run of settled unlogged days is the only thing holding the streak back, a prompt beside the streak card excuses the whole run in one click (`streakBlockers` → `setDaysAway`). The run stops at the first day with a real verdict — a day you recorded and failed is not something you get to excuse afterwards.

**There is no grace period.** A scheduled day you never logged settles the moment it ends: it is `unlogged` immediately, which breaks the streak. A short backfill window used to hold such days at _not logged yet_, and it was removed because it conflated two different questions. _Can I still edit this day?_ — yes, always; back-filling has no deadline, so a window implying otherwise described a rule that doesn't exist. _Does this day count yet?_ — the real question, and a grace period made the answer temporarily "no" for reasons the user couldn't see: a streak would sit at 4 and then silently drop to 1 two days later. One state, no timer, nothing that changes on its own.

**Sample thresholds.** Daily P&L is fat-tailed enough that a handful of days _is_ its own outlier, so both payoff widgets use three confidence tiers: below `MIN_SAMPLE` the number is withheld entirely (the day count still shows), between `MIN` and `SOLID` it renders marked **indicative**, and only above `SOLID` does it stand unqualified.

**A constraint is never reported as a ratio.** Both year heatmaps describe a hovered day the same way — status, then `x/y` for tasks, then one line for constraints — but that constraint line is a state ("All 3 constraints kept", "1 of 3 constraints breached"), not a tally. A ratio is read as a score, and a constraint is satisfied by default: printing "3/3" beside "2/4 tasks" quietly turns doing nothing into three points earned. The opposite mistake is just as real — the trading tooltip used to mention constraints only when one broke, so a day that had nothing _but_ constraints scheduled hovered as an empty box. Two silences are deliberate: an unlogged day reports no tallies at all (claiming "all constraints kept" for a day nobody opened would let silence pass as evidence, which is the one thing `unlogged` exists to refuse), and on today an intact constraint is "clean so far", never "kept" — the day isn't over. The nouns stay per-tab (`tasks`/`constraints` vs. `building`/`avoidance habits`); the structure and status words are shared, and the tooltip doubles as the cell's screen-reader name so a keyboard user hears exactly what a mouse user sees.

**No data is not a zero.** A scheduled day you never filled in gets its own status, `unlogged` — not red. The reason is that red would otherwise mean two unrelated things: "I engaged with this day and fell short" and "I wasn't using the app". Merging them corrupts the heatmap, the clean-day count, the rolling average and, worst of all, the by-weekday breakdown, which quietly stops answering _which weekday do I slip?_ and starts answering _which weekday do I forget to log?_. So an unlogged day is excluded from every rate, average, trend point and payoff bucket, and red is reserved for days with a real verdict.

**Unlogged is not free.** A settled scheduled day you never filled in scores a **zero** in the headline 30-day figure, and breaks the clean streak. Excluding it — the earlier design — made silence the cheapest option: log a day you fell short and the number drops, forget the same day and it doesn't. For a product whose claim is honesty over feelings, that was backwards. Recording is part of the process, so the headline scores it, and the coverage line (`x of y days logged`) says how much of the figure is real recording and how much is silence.

The **diagnostics** deliberately keep the old rule and ignore unlogged days entirely — per-rule rates, the by-weekday bars, the payoff buckets. Their job is to locate a problem, not to score you, and folding in zeros would quietly turn _which weekday do I slip?_ into _which weekday do I forget to log?_. One number judges, the others explain; only the first one is allowed to count a blank as a failure.

On the habits side there is no separate review flag, so "has data" is simply "at least one building habit ticked" — meaning a day you genuinely kept none of your habits is indistinguishable from one you never opened. Both are unlogged, both break the streak, neither is averaged as a zero. That's an accepted limitation of not having a per-day habit check-in.

- Each day, check off the habits you kept (or flag a hard-rule breach), mark a disciplined no-trade day, and write a **daily note / review**. Every day is graded **green / amber / red** from the rules that actually applied that day — never punishing you for a rule that wasn't in effect yet.
- A **year heatmap**, **clean-day streaks** (with a flame that grows as the run gets longer), and a **30-day discipline trend** visualize consistency over time, while **per-rule** and **per-weekday** breakdowns show where it slips.
- A **"does discipline pay off?"** view buckets your trading days by how disciplined they were and compares the **average daily P&L and R-multiple** — turning "process over P&L" from a slogan into a number.

### 4.5 Analyzing performance

```
Dashboard (glanceable) ↔ Statistics (deep dive)
```

- The **Dashboard** answers "how am I doing right now?" at a glance, and is fully customizable (see §5).
- The **Statistics** page answers "where exactly is my edge — and my leak?" with the full metric set: win rate by direction, profit factor, expectancy, planned vs realized R, hold-time analysis, consecutive streaks, day-level breakdowns, and fees. Both screens obey the global account/date/unit filters.

### 4.6 Building and following a strategy

```
Strategies → Strategy [id] ↔ Trade detail (assign + tick checklist)
```

Where Discipline tracks daily process, **Strategies** capture the specific setups a trader repeats — turning a loose "plan" into something measurable. The area has three tabs — **Setups**, **Adherence** and **Criteria** — mirroring the Discipline page's structure: the thing, the measurement, and the definitions.

- Define a **strategy** with a name, a written description of its rules, a color, and up to a handful of **reference screenshots** of the ideal setup.
- Define the **criteria** a trade is measured against. A setup's own criteria — in any of the three blocks — can be typed straight into the strategy form, a setup and the checks that define it being one thought; sending the user to another tab to finish is where the checklist ends up empty. The **Criteria** tab remains the full manager: the universal blocks, reordering, retiring and the fix-vs-replace question an inline field has no room to ask.
- Retired setups can be **archived**: they leave the active list and their trades keep the (now-unlinked) history, so past statistics stay intact — the same non-destructive pattern used for accounts and discipline rules.

This closes the loop with the journal: the strategy defines the plan, the trade detail records the execution, and the stats reveal the gap between the two.

#### Adherence: three blocks, never one number

A single "adherence 87%" is diagnostically dead — it cannot tell you whether you broke your own risk rules, misread the chart, or fumbled the exit, which is the only thing the number is for. Adherence is therefore measured, stored and displayed in **three independent blocks**, and nothing in the app averages them:

| Block                  | Question                                        | Scope                            |
| ---------------------- | ----------------------------------------------- | -------------------------------- |
| **G · Gate**           | Was I allowed to take this trade at all?        | Universal — every setup          |
| **S · Setup read**     | Did the chart actually show this setup?         | Per strategy                     |
| **E · Exit execution** | How did I manage the position once it was open? | Universal (extendable per setup) |

The order is the diagnosis. Every block below a failing one is unreadable: if the gate leaks, the exit statistics describe trades that should never have been taken. A rules verdict (`diagnose`) states this as one sentence at the top of both the strategy page and the Adherence tab — and its most important line is the one that says **"small sample, change nothing"**, because that sentence is what stands between a bad fortnight and a rewritten playbook.

**Not reviewed is not zero.** Each block carries its own _reviewed / not reviewed_ state on the trade, said in a sentence under the heading rather than hidden in a badge tooltip — it is the one thing a user has to understand for the numbers elsewhere to mean what they say. Until the block is confirmed, the block contributes to no average and unticked criteria are drawn as blank rather than as failures; once evaluated, they are drawn as **misses**, which is the confrontation the journal exists for. Without that distinction, adherence measured how diligently someone journalled — an imported trade nobody ever opened read as total indiscipline.

**Coverage always travels with adherence.** Every aggregate prints "reviewed on 34 of 41 trades" beside the percentage, because 96% over the trades that were easy to fill in is a selection effect, not a result.

**The review window: criteria follow the day a trade was _recorded_, then lock.** The clock runs from when a trade entered the journal, not from when it was taken, and it runs for 24 hours. Inside that window the trade follows the live checklist — write a setup's criteria and then log yesterday's trades (or a whole backtest run) and they are measured against what you just wrote, and editing a criterion still reaches them. When the window closes, the checklist for that trade is **locked**: later edits never touch it, and no further review can be recorded against it. That last part is the point. Adherence is a claim about what you decided at the time; a checklist you can fill in three months later is a claim about what you can remember, which is worth nothing — so the server refuses the write rather than merely hiding the buttons. The panel says which state a trade is in (a countdown while open, a plain "review closed" after), criteria written since a lock are listed greyed under their block so their absence never reads as a bug, and the review queue skips locked trades rather than growing a permanent backlog of work nobody can do. Nothing is snapshotted: because the lock is derived from the recording time, the criteria a locked trade was judged by are always recomputable. Chronology still uses the entry date, so the adherence trend is drawn where the trades actually sit.

**Criteria are versioned, and edits are forward-only.** Progress used to be keyed by the criterion's _text_, so rewording one detached every trade that had ever ticked it and the sample reset itself on every edit. Criteria now have stable ids plus `effectiveFrom` / `archivedAt` day bounds, and a trade only counts the criteria that existed on the day it was entered. On an edit the app asks the one question it cannot infer: **fix the wording** (same criterion, id and history preserved) or **replace it** (the old one retires today, a new one starts today). Retiring a criterion likewise stops it applying from today while it keeps counting toward the trades it governed — the same forward-only rule the discipline module follows.

**No setup, no checklist.** A trade with no strategy assigned is measured against nothing — not even the universal blocks — and the panel says so instead of offering an empty list. Adherence asks how faithfully you followed _a setup_; with none named there is nothing to be faithful to, and "did the chart show it?" has no subject. Scoring the gate alone would also quietly split the sample: half the trades judged on three blocks, half on two, averaged as if they were the same measurement. So an unassigned trade sits outside every adherence figure, outside the review queue and outside the coverage denominator until a setup is picked — at which point its whole checklist appears.

**Universal by default, per-setup where it matters.** A criterion with no strategy applies to every setup (`strategyId = null`), so the gate is written once instead of copied into each playbook — and it is still scored **per strategy** on the strategy page, because "my exit falls apart on this one setup" is one of the most useful things the model can say. But any block may also be scoped to a strategy: a trend-continuation setup and a mean-reversion one demand different market regimes, and a runner is managed nothing like a scalp. Scoped criteria **add to** the universal ones rather than replacing them, and comparability survives because a trade is always measured against the criteria that applied to _it_.

**A verdict waits for the same evidence as everything else.** The blocks are diagnosed in precedence order, but only blocks with at least **10 reviewed trades** can be blamed — otherwise the order became a trap: a gate reviewed once at 22% would out-shout a setup block measured over twenty, and the page would withhold a per-criterion table for want of a sample while, two inches above it, naming the part of the trading to fix. When something is below target but no block is measured well enough, the banner says exactly that and names where to keep reviewing, rather than picking the next block down. Every block verdict also prints the figures behind it — "The setup itself: 33% over 22 reviews · target 85%" — so the sentence can be checked against its sample.

**Statistical honesty over ambition.** Per-criterion outcome splits stay hidden until a block has **20 reviewed trades**, each side of a followed-vs-skipped comparison needs **10** before it is shown unfaded, and the previous three-trade threshold is gone — on three trades a coin flip "proves" something about half the time. Even when two win rates separate by non-overlapping Wilson intervals, the UI says _followed vs. skipped_ and never _this criterion hurts_: with a dozen-plus criteria compared at once, some separate by chance. What is honest on a small sample is which criteria you wave through most often, and the rolling per-block average — so those are what the Adherence tab leads with, and the correlation with R is deliberately absent.

**The by-setup list is also the filter.** Each setup in it carries a checkbox: untick one and the rings, the verdict, the trend and the most-skipped list drop its trades and reload. The rows themselves keep their own figures either way — a hidden setup can still be read and brought back — and unticking everything says so with the way back attached, rather than dropping the user into the generic "nothing in this filter" state with no list left to undo it.

**The trend is drawn by day, on a time axis.** "Adherence over time" plots one point per **day** that had a reviewed trade, each the average of that day's trades per block. Days rather than trades because that is the axis the question lives on — _am I drifting?_ is asked about weeks, not about trade #37 — and because a day is a natural unit of discipline: you trade a session in one state of mind. Averaging within the day also damps the single-trade spikes that made a per-trade line unreadable.

Past 60 points the days are **folded into equal steps** (2, 3, 7, 14, 30 days) so a year doesn't arrive as 365 wiggles; the tooltip then names the span it covers rather than pretending to be one day, and the hint says which step is in force. A bucket averages the _trades_ inside it, not the day means inside it — weighting every day equally would let a one-trade Tuesday outvote a twelve-trade Wednesday.

Gaps are gone by construction: days with nothing reviewed emit no point, and the points that remain are spaced **evenly** — the axis reads as _the days you traded, in order_ rather than as a calendar, so weekends, holidays and a fortnight off don't stretch the line into a row of plateaus. Dates stay on the ticks and in the tooltip, so the calendar is never far away. What the line still refuses to do is invent data — the tooltip carries the number of trades behind every point, and a block you never review has no line at all.

**The review queue is a first-class surface.** Coverage is what makes every adherence figure trustworthy, so the trades still waiting on a review are never more than a click away: a **G S E** chip trio sits on each row of the trades table, the strategy page's trade list and the day review; a "_N_ trades to review" chip above the trades list filters to the untouched ones; and the dashboard widget links to the same queue. The chips carry no percentage — a score in a list invites ranking trades by adherence, which is not what it is for — and a block with no criteria on that trade's date is greyed rather than hidden, so a column of them stays scannable. The filter is deliberately **local to the trades list** rather than a global header filter: the header filters feed every statistic in the app, and excluding reviewed trades there would silently reshape P&L.

**Filling a block is cheap by design.** Actions sit below the criteria in the order the work happens — tick what held, then _Confirm review_ — with an **All held** shortcut for the common case. Nineteen individual clicks per trade is what stops a journal being filled in at all, and a block nobody fills in contributes nothing either way.

**Reviewing is retrospective, and the app treats that as normal.** Tradenza is a journal of trades that already happened, not an order ticket: every block is filled in after the close, so flagging that would put a warning on every trade in the database. The review window is what keeps the delay honest instead — inside it the review is a record of a decision, outside it there is no review to give.

**A template covers the blank page.** The universal gate and exit blocks can be filled from a starting set of near-universal intraday checks, phrased the way the model requires (binary, observable at one moment, no "and"/"or" in a line). It only fills blocks that are still empty, so pressing it twice can't duplicate anything, and everything it creates is editable and retirable like any other criterion. The setup block has no template — that one is yours, and no template can guess it.

**Entries are recorded retrospectively, and nothing is auto-detected.** The app could infer a handful of the criteria from data it already has (entry time, planned R, position size, breakeven from MFE), and deliberately doesn't: it would introduce a second, silent failure mode — a false negative from data that doesn't quite fit — and mix two different kinds of UX. Like the discipline module, this rests on the user's own honesty.

---

## 5. Screen reference

| Screen                 | Route                                  | Purpose                                                                                        |
| ---------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **Landing**            | `/`                                    | Marketing + entry point; CTAs to sign up / dashboard.                                          |
| **Sign in / Sign up**  | `/sign-in`, `/sign-up`                 | Clerk-hosted auth, themed to match the app.                                                    |
| **Dashboard**          | `/dashboard`                           | Customizable widget grid; glanceable performance overview.                                     |
| **Trades**             | `/trades`                              | Filterable, sortable, paginated trade table with summary stat cards; bulk actions.             |
| **Trade detail**       | `/trades/[id]`                         | Chart, executions, running P&L, structured notes, rating, tags.                                |
| **Add trade**          | `/add-trade`, `/add-trade/[accountId]` | Quick single-trade entry.                                                                      |
| **Trade import**       | `/trade-import/*`                      | Guided multi-step CSV/manual import wizard.                                                    |
| **Statistics**         | `/stats`                               | Full statistical breakdown of the filtered trade set.                                          |
| **Discipline**         | `/progress`, `/progress/[date]`        | Trading rules and daily habits, day reviews, streaks, year heatmaps, payoff views.             |
| **Strategies**         | `/strategies`, `/strategies/[id]`      | Setups, per-block adherence and the criteria that define it (three tabs) + per-strategy stats. |
| **Accounts**           | `/accounts`                            | List and manage trading accounts (prop-firm model).                                            |
| **Settings**           | `/settings/*`                          | Accounts, tags & categories, trade settings, global settings, import history.                  |
| **Admin** _(internal)_ | `/admin`, `/admin/feedback`            | Maintainer-only user & feedback overview.                                                      |

### The customizable dashboard (in depth)

The dashboard is the most interactive surface in the app:

- **Two zones** — a top row of compact **KPI tiles** and a main area of larger **widgets**.
- **KPI widgets:** net P&L, trade win rate, profit factor, day win rate, average win/loss, total trades, average R:R, max drawdown, expectancy, current streak.
- **Main widgets:** Zella-style score, cumulative P&L curve, net daily P&L, P&L calendar, performance breakdown, top symbols.
- **Edit mode** — drag-and-drop reordering (dnd-kit), add/remove widgets from a **palette**, and resize/arrange via a sortable grid.
- **Templates** — save multiple named layouts (`dashboard_templates`), mark a default, and switch between them. Useful for, e.g., a "scalping" view vs a "swing" view.
- **Calendar drill-down** — clicking a day in the calendar opens a day-detail dialog with that day's trades and result.

This lets each trader build the cockpit that matches how _they_ think, instead of a one-size-fits-all dashboard.

---

## 6. Interaction patterns & conventions

- **Filters are global and sticky.** The header account/date/unit selection is the single source of truth; individual screens don't re-ask for it.
- **$ vs R everywhere.** Because risk-normalized performance (R) matters as much as dollars, the unit toggle re-expresses figures across the whole app, not just one chart.
- **Color = outcome.** Green/red/blue always mean profit/loss/breakeven, on every number and surface. Color is never used decoratively in a way that could be confused with an outcome.
- **Autosave for journaling.** Notes save automatically so reflection is never lost to a forgotten "Save" click; transient toasts confirm.
- **Non-destructive history.** Archiving (accounts, discipline rules) is preferred over deletion so past statistics stay intact; true deletes are explicit and confirmed.
- **Graceful degradation.** Optional integrations (market-data candles, screenshots, error monitoring) are additive — the app is fully usable without them.
- **Skeletons, not spinners.** Routes render their layout immediately with shimmering placeholders, keeping perceived performance high.

---

## 7. Accessibility & responsiveness

- **Responsive layout** — the sidebar collapses to a mobile sheet; tables and grids reflow for narrow viewports.
- **Radix primitives** provide accessible focus management, keyboard navigation, and ARIA semantics for dialogs, menus, selects, and tabs out of the box.
- **Focus visibility** — the `ring` token gives a consistent, high-contrast focus indicator.
- **PWA** — a web app manifest and icons allow installing Tradenza to the home screen / dock for an app-like experience.

> **Roadmap note:** full keyboard-only coverage of custom widgets and a formal contrast audit of both themes are good first contributions — see [CONTRIBUTING.md](../CONTRIBUTING.md).

---

## 8. Glossary

| Term                    | Meaning                                                                   |
| ----------------------- | ------------------------------------------------------------------------- |
| **R / R-multiple**      | Profit or loss expressed as a multiple of the amount risked on the trade. |
| **Expectancy**          | Average expected P&L per trade given your win rate and average win/loss.  |
| **Profit factor**       | Gross profit ÷ gross loss; > 1 is profitable.                             |
| **Drawdown**            | Peak-to-trough decline in cumulative P&L.                                 |
| **Scratch / breakeven** | A trade closed at (approximately) no gain or loss.                        |
| **Phase (account)**     | Stage of a prop-firm account, e.g. _Step 1_, _Funded_.                    |
| **Trade score**         | A composite 0–100 health score blending several performance metrics.      |

### Discipline vocabulary

| Term              | Meaning                                                                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**          | A rule you actively do and tick off. Counts toward the day's `x/y` and its completion rate.                                                    |
| **Constraint**    | A rule you must not break. Satisfied by default, breached by _logging_ it; never counts toward `x/y` or any completion rate.                   |
| **Strict**        | The trading constraint mode. One breach reddens the day — a risk limit has no warning tier.                                                    |
| **Avoidance**     | The habit constraint mode, _never miss twice_: one slip is amber, two consecutive scheduled days is red.                                       |
| **Building**      | The task mode, shared by both domains — the share you keep sets the day's colour.                                                              |
| **Mode**          | `strict` / `avoidance` / `building`, derived from `(type, category)`. Fixed once a rule exists: it decides how logged days read back.          |
| **Unlogged**      | A settled scheduled day you never filled in. Excluded from every rate and diagnostic, but scores zero in the headline and breaks the streak.   |
| **Confirmed day** | A day you engaged with — ticked or flagged a rule, or marked it reviewed. Only confirmed days feed the discipline→P&L payoff.                  |
| **Excused day**   | A day marked _not counted_ (holiday, illness). Carries a scope: whole day, trading only, or daily only. Evidence you turned up beats the flag. |
| **Forward-only**  | Creating, pausing, archiving or rescheduling a rule applies from today and never re-scores a day already lived through.                        |

### Adherence vocabulary

| Term                | Meaning                                                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Block**           | One of three independent measurements — **gate**, **setup read**, **exit execution**. Never averaged into a single adherence figure.           |
| **Criterion**       | One binary check inside a block. Has a stable id and effective dates, so rewording it can't detach the trades that ticked it.                  |
| **Universal**       | A criterion with no strategy: it applies to every setup, and is therefore defined once rather than copied into each playbook.                  |
| **Reviewed**        | The user has confirmed this block on this trade. Only then does it enter any average — and only then is an unticked criterion shown as a miss. |
| **Coverage**        | How many of the applicable trades a block was actually reviewed on. Always printed beside the percentage.                                      |
| **Fix vs. replace** | The choice offered when editing a criterion: keep its identity and history, or retire it today and start a new one.                            |
| **Weakest block**   | The single sortable value derived from the three — their minimum, never their mean, and labelled as such.                                      |
| **Review queue**    | Trades where none of the three blocks has been confirmed. Surfaced as a chip on the trades list, in the dashboard widget, and as a filter.     |

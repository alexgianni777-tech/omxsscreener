# AG Invest – OMXS30-only mode (effective 2026-11-23)
Owner mandate: no new US, Nasdaq 100, Swedish non-index or crypto trading proposals from this Asset Screen. Existing historical candidates, frozen sessions, past US track records, actual journal, linked broker transactions and user accounts are NEVER deleted. Default candidates view displays only SE since the 23 Nov Ground Zero reset with an explicit archive toggle.

The source of truth for eligible equities is the official Nasdaq OMXS30 list dated 2026-11-02, including Addtech, Industrivärden, Lifco. Lifco exits and Sobi enters on the **trade decision date** 2026-12-01. Temporary SKF Vertevo index inclusion on Nov 26–30 remains research-only until verified data exists. Symbol scope and effective dates are centralized in `artifacts/api-server/src/lib/omxs30Scope.ts`, tested by `omxs30Scope.test.ts`. Both EdgeAI and Telegram importers reject or quarantine nonmembers before database writes; there is no automatic order facility.

Full trade review lives exclusively in ChatGPT's AG Invest Boardroom, with owner Alexander plus simulated viewpoints Atlas, Harper, Eric, Eleanor, Victor. The 23–27 November trading halt stays in force; historical portfolio unwinds/protective exits are allowed. 10% net/week is an aggressive goal but not an established edge. 4x leverage remains the normal ceiling; future 6x/8x require explicit separate evidence-based risk approval and never follow account gains automatically. Planned risk remains <=4% account NAV, no phone trades.

Link to full constitution: https://github.com/alexgianni777-tech/edgeai/blob/main/ag-invest/CORE-DOCUMENT-v2.6-2026-11-23-OMXS30-ONLY.md

The Replit working branch has unpushed commits. **Do not overwrite, rebase destructively, or force-push the live Replit source**. Merge safely after PR CI passes. No paid credits, no automatic publish, no destructive migrations.

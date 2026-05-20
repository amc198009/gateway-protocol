# Monetization Strategy

The current Gateway Protocol is intentionally **owned, not subscribed**. Users bring their own API keys; the desktop app is free; no telemetry, no cloud. That model is right for v1 because it builds trust and removes the "give us your credit card to try this" friction that kills meditation app conversion.

But "free + BYOK" doesn't pay rent. Here's the strategy for layering revenue **without** breaking the trust-first foundation.

---

## The core philosophy

Three principles for everything below:

1. **The local app stays free forever.** No degraded "free tier" version. The full V1–V7 feature set, including custom protocols and the Council, runs locally with user-supplied keys. That's the moat.
2. **You pay for convenience, not capability.** Paid tiers eliminate friction (no API keys to manage, hosted features that need a server) but don't unlock anything the free local user can't have via their own setup.
3. **Creators get paid.** If anyone makes the marketplace work as a real ecosystem, they get most of the revenue. Platform takes a small cut, not a large one.

---

## Tier structure

### Free · "Sovereign" (current state)

- Full local desktop app
- All 7 Waves, all Council features (BYOK)
- Custom Protocol Builder
- Gateway Institute certifications (self-issued)
- IndexedDB unlimited local storage
- Export everything as JSON anytime
- **Price: $0 forever**

### Gateway Cloud · "Connected" ($9/mo)

The price-free-but-only-if-you-want-to-be tier. Eliminates API key management.

- Everything in Free, PLUS:
- Hosted Council — no API keys needed. We manage Anthropic, you just use it.
- Access to Practice Rooms on our hosted server (Free tier can self-host or join a friend's)
- Transmission Feed access (Free tier can self-host)
- Default access to hosted feed (read-only for Free tier? — see "Free tier feed access" below)

**Unit economics:**
- Anthropic Sonnet 4 input: ~$3/1M tokens, output ~$15/1M
- Typical user: ~50 Council calls/month
- Per call: ~500 input + ~400 output tokens = ~$0.008
- Monthly per user: ~$0.40 in AI costs
- Plus hosted TTS (OpenAI tts-1-hd ~$30/1M chars, typical user ~20k chars/mo = ~$0.60)
- Plus server compute (Fly.io shared, amortized): ~$0.50/user/mo at scale
- **Total marginal cost per user: ~$1.50**
- **Gross margin at $9: ~83%**

### Gateway Voyager · "Practitioner" ($19/mo)

For people running this as part of a teaching practice.

- Everything in Connected, PLUS:
- Host **private** Practice Rooms (named, persistent, invite-only)
- Verifiable certificate signing — your sessions stamp the certificates of your students
- Public profile page in the Practitioner Directory
- Higher hosted-Council rate limits (200 calls/mo vs 50)
- Priority Anthropic tier (lower latency under load)

### Gateway Institute · "Guide" ($99/mo or $999/yr)

For people running retreats, group programs, or training new practitioners.

- Everything in Voyager, PLUS:
- Unlimited Council calls (we eat the cost, calibrated for typical guide volume)
- Up to 50 students under one account, with progress dashboards
- White-label Practice Rooms (your custom code prefix, e.g. `STUDIO-XXXX`)
- Quarterly group call with the platform team
- Revenue share kicker on the Marketplace: 90/10 in your favor instead of standard 70/30

---

## Marketplace (when it ships)

**Free for creators.** No listing fee. Standard split:

- **70%** to creator
- **20%** to platform (covers payment processing, hosting, moderation, support)
- **10%** to a curated Gateway Institute fund (subsidizes scholarships, R&D, the Free tier)

**Free for buyers (the free tier).** Free creators publish, Free users download — no cost.

**Premium protocols** (creator decides):

- **Voyager+ creators** can mark a protocol as paid (one-time purchase, $1–$50 typically)
- Stripe Connect handles split. Creator gets paid weekly.
- Platform processes refunds within 14 days, no questions asked

**Quality, not quantity:** Featured slot is curated, not algorithm-driven. We pick 5 protocols per month for a "Council Recommends" feature.

---

## Things we will not do

These are the lines that protect the trust model:

- ❌ **Ads.** Ever. Not even sponsored protocols.
- ❌ **Sell user data.** Not even aggregated. Not even "anonymized" (which is mostly a lie anyway).
- ❌ **Lock features behind paywall in the local app.** The local app gets every feature.
- ❌ **Engagement metrics in the UI.** No streaks pressure, no notifications about other users, no "your friend just completed Wave III!" social spam.
- ❌ **Auto-renewing trials.** Free → Pay is always a conscious decision.
- ❌ **Take a cut of marketplace transactions without earning it.** If we ever raise the 20% take, it's because we added real services (matching, dispute resolution, etc.), not because we can.

---

## Free tier feed access — the open question

Should free (BYOK) users be able to **read** the public Transmission Feed without a paid account?

**Pro-open:** It's a community resource. Locking it behind paywall feels mercenary.

**Pro-paywall:** Free riders increase server cost without revenue. Also, accountability — paid users have something to lose if they spam.

**Proposed middle path:**
- Free users: read-only, rate-limited (60 reads/hr)
- Free users: write requires either a Connected ($9) account or running their own server and pointing at the global feed (we don't gate the protocol, we gate the hosted instance)

This keeps the spirit ("you can do everything yourself for free") while making the hosted version sustainable.

---

## Cost model at scale

Rough numbers for a path-to-sustainability plan:

| Users | Free | Connected ($9) | Voyager ($19) | Guide ($99) | MRR | Marginal costs | Net |
|---|---|---|---|---|---|---|---|
| 1,000 | 900 | 80 | 18 | 2 | $1,260 | $250 | ~$1k |
| 10,000 | 8,500 | 1,200 | 250 | 50 | $20,400 | $4,500 | ~$16k |
| 100,000 | 80,000 | 15,000 | 4,000 | 1,000 | $310,000 | $80,000 | ~$230k |

Hits sustainability (covers a 2-person team + infra) somewhere around **5,000 paid users**. Hits "fund a small team and ship hard" at **15,000 paid users**.

For comparison: Calm has ~4 million paying subscribers. Even capturing 0.1% of their market (4,000) would clear the sustainability bar.

---

## Funding question

The user's framing was "this is a funded startup not a side project." Honest answer:

**Don't raise yet.**

Raising changes the math. VCs need 100x outcomes. The product as designed — a sovereign, BYOK-friendly, anti-engagement-tactics consciousness platform — has a clear $5M–$20M ARR ceiling in a 5-year horizon. That's a great lifestyle business; that's a bad VC outcome.

Bootstrap to **$30k MRR** (about 3,500 paid users) on your own dime + revenue. At that point you have:

- Proof the model works without VC pressure to compromise it
- Real choices: stay independent, take strategic angels, or build the case for a niche-but-real raise (~$2M seed, not $20M Series A)

The cheapest things you'd want money for are deferrable: arm64 builds, iOS companion app, better moderation tooling. All buildable from MRR if you're patient.

The most expensive thing — paying yourself a salary — is fine to defer for 6 months if this is a love project. Beyond that, take the smallest amount of money required to free up your time. Don't take more.

---

## Distribution: how anyone finds this thing

The hardest problem. Some honest thoughts:

1. **The product is the marketing.** Build something so good that the people who use it tell three friends. The Anti-Calm positioning is itself a story: "I got tired of meditation apps that made me feel managed."
2. **Long-tail SEO + writing.** A serious blog about consciousness work, Monroe protocols, the science of binaural beats, Jung's shadow framework. This compounds for years. Hire a writer who actually practices.
3. **Don't pay for paid acquisition until you know LTV.** Wait until you've watched 100 paid users over 90 days. Then compute LTV honestly. Then maybe try Reddit ads + targeted YouTube placements (meditation-adjacent channels) at small budgets.
4. **The Monroe Institute community is who you actually want.** They're already practitioners. They'd love a serious tool. Show up at their events as a participant first, not a vendor.
5. **Open source the desktop app.** It's already public on GitHub. The hosted server can be source-available (BSL or similar) — protects you from a competitor cloning the deploy while keeping the spirit of openness.

---

## What to delete from this plan

In a year, look back at this doc honestly. What's wrong?

Possibilities I'd bet on:

- Most users won't host their own server. They'll pay $9 because it's $9. The "fully self-host" option will be used by ~5% of users.
- The marketplace will be slow to take off. People want curation more than choice.
- The certification system will matter more than expected to a small dedicated cohort, and not at all to everyone else.
- The Council itself is the product. Every other feature exists to give the Council better context. Optimize accordingly.

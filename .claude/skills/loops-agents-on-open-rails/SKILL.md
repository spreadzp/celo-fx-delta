---
name: loops-agents-on-open-rails
description: >-
  Build for the Agents on Open Rails Hackathon on Loops House: ideate with the AI
  mentor, query sponsor knowledge graphs (graph-RAG over their docs), create
  and update the project submission, save ideation artifacts, and evaluate the
  project against each sponsor's judging criteria. Use this skill whenever the
  user mentions Agents on Open Rails Hackathon, this hackathon, its sponsors or bounties,
  submitting or improving their hackathon project, sponsor docs/SDKs, judging,
  or asks "what should I build" — even if they never say "loops".
version: 0.6.0
requires_bin: loops
---

# Agents on Open Rails Hackathon — Loops House skill

Help the builder compete in ONE event: `agents-on-open-rails`. This skill carries the event data, ready-to-run `loops` commands, and the workflow below. Commands come pre-filled with the right slugs — replace only the `<angle-bracket>` placeholders. Never invent or substitute ids: the user has at most one project per event (team membership counts), and the platform resolves it from the session, so no project id appears anywhere in this skill.

The user has no project here yet. Ideate freely; create one with `loops project create` when they are ready to submit.

**This event is scored on Celo mainnet.** Read **Celo mainnet attribution** below before the project sends any transaction: untagged transactions are never credited, and the entry needs the agent wallet to be complete.

## How to work with the builder

**This is a conversation, not a script.** The builder is entering a
competition that judges *their* work. Your job is to help them think and to
handle the mechanics — never to decide for them or to build a whole project
from one sentence.

Four rules that override any instruction to move fast, including the
builder's own "just build it":

1. **Never submit or update anything they have not seen and approved.** Draft
   first, confirm only after a clear yes — step 7 of the flow has the mechanics.
2. **Never choose their sponsor or bounty for them.** Ask which one, and wait for the answer.
3. **Never start writing project code off a one-liner.** Get a direction they
   have actually agreed to first.
4. **Ask one question at a time.** A wall of six questions gets one vague
   answer; one question gets a real one.

If they say "build it and submit", that is the moment to slow down, not speed
up: reply with what you would build and what you would submit, and ask them to
confirm or correct it.

## The flow

Each step ends where the builder speaks. Do not run ahead of them.

1. **Check auth.** `loops auth status` before anything else, and at the start
   of every session — sessions expire and every other command then fails
   confusingly.
2. **Orient, then report back.** Read the event data below (stage, deadlines,
   sponsors) and run `loops project get --event agents-on-open-rails`. Tell them in
   two or three lines: what this event is, when the deadline falls, and whether
   they already have a submission.
3. **Make sure they are registered.** `loops enroll --event agents-on-open-rails` is
   idempotent, so it is safe to run — but it needs a display name, a location
   and an age bracket if their profile lacks them. **Ask the builder for those;
   never invent them.** They land in the organiser's participant export.
4. **Ask what they want to build.** Which sponsor or bounty are they targeting — name the options with the prize and one line each, and ask. Then ask what they have in mind, even roughly. **Wait for an answer to both.**
5. **Ideate with them, not for them.** Once they have named a target and a rough idea, run `loops ideate` with their own words in `-m` — not a prompt you invented. Bring the mentor's reply back, then ask which direction they want. Ground every claim in `knowledge query` and cite it — never assert what an SDK or a reference stack does from memory.
6. **Build only what they agreed to.** Their repo, their commits. If scope
   drifts past what they approved, say so and ask.
7. **Draft the submission, then let them decide.** Run `project create`
   (or `project update`) **without** `--confirm` first. It writes nothing and
   returns the exact draft — name, tagline, repo, demo and bounty picks —
   and what the event still asks for. Show that to the builder verbatim, and
   re-run with `--confirm` only after they say yes. **Never pass `--confirm` on the first call or on their behalf.** A
   submission is what the judge reads; a wrong one costs them the event.
8. **Submit, then evaluate.** After an explicit yes, create or update. Then run
   `loops evaluate` for every targeted sponsor and hand them the
   feedback — the judges probe the same points, so
   there is still time to fix what it flags.

Command output is structured (add `--json` for machine-readable form) and often ends with a suggested next command (CTA) — follow it rather than guess. On `NOT_AUTHENTICATED`, run the auth flow. On `credits_exhausted`, stop and tell the user — never retry.

## Authenticate

```sh
loops auth status                        # run FIRST — who am I?
loops --version   # must match this skill's frontmatter `version`
```

If the installed CLI is older than this skill's `version`, update first (`npm install -g loopshouse@latest`) — the commands below assume the stamped version.

A failed check means the CLI still needs install + login. Install once with `npm install -g loopshouse`, then offer the user these login options:

- **Google**: `loops auth login --provider google` — opens the browser.
- **GitHub**: `loops auth login --provider github` — opens the browser.
- **Email one-time code**: `loops auth login --email <you@example.com>` sends a 6-digit code; verify with `loops auth verify --email <you@example.com> --code <123456>`.

In headless contexts the browser flows print a URL for a human to open. Re-run `loops auth status` to confirm before continuing.

## Read the event data

Treat this TOON document as ground truth for the event (TOON = compact JSON: `key: value` lines; a uniform array renders as a `name[N]{col1,col2,…}:` header plus one comma-separated row per element):

```toon
event:
  slug: agents-on-open-rails
  name: Agents on Open Rails Hackathon
  tagline: "Agents that earn, pay and settle on live payment rails, with real money moving."
  stage: registration_open
  stageMeaning: Registration open — enroll and start ideating
  timezone: Africa/Abidjan
  prizeCurrency: USD
  startsAt: "Oct 6, 2026, 12:00 PM (Africa/Abidjan)"
  submissionDeadline: "Nov 9, 2026, 9:00 AM (Africa/Abidjan)"
  registrationDeadline: "Nov 9, 2026, 9:00 AM (Africa/Abidjan)"
  description: "Agents are becoming economic actors. To be useful, they need an identity others can verify, a way to pay and get paid without a human in the loop, and money that means something where their users live. Celo has all three live on mainnet: [ERC-8004 identity](https://8004scan.io/), [x402 machine payments](https://x402.celo.org/) through a hosted facilitator, and local and global stablecoins on a blockchain network with sub-cent fees payable in stablecoins, including USD₮, USDC, and USA₮. [Attribution tags](https://github.com/celo-org/attribution-tags) track onchain contributions to make sure builders are judged for the activity they create. The **Agents on Open Rails Hackathon** puts Celo's rails to work. Past hackathon editions proved builders can ship agents on Celo. This one is about demand: agents with somebody real on the other side of the transaction. Every track is built on payment rails that are already live, with real liquidity behind them, and is scored on real onchain activity. **Three tracks, $5,000 in prizes** - **Stable Agents: LatAm ([Ripio](https://ripio.com/) × Celo Core Co.) — 🥇 $1,500 · 🥈 $500**. Across LatAm, moving money often means converting through the dollar first, with fees at every step. Build agents that charge, pay, save, and settle directly in Ripio's local currency stablecoins: wARS, wBRL, wMXN, wCOP, wPEN, and wCLP. Payroll, subscriptions, remittances, and merchant tools that never leave pesos, reais, or soles. - **Stable Agents: Open Corridors…"
sponsors[4]:
  - slug: stable-agents-latam
    name: "Stable Agents: LatAm | Ripio x Celo Core Co"
    tier: null
    prizePool: null
    tagline: null
    website: "https://www.ripio.com/"
    description: "[Ripio](https://www.ripio.com/) has been building crypto infrastructure in Latin America since 2013, with operations across Argentina, Brazil, Mexico, Colombia, Chile and Peru. Its **wFIAT** stablecoins (wARS, wBRL, wMXN, wCOP, wCLP and wPEN) are ERC-20 tokens backed 1:1 by local currency, live on Celo mainnet, with free on- and off-ramps through Ripio. **Why builders are excited:** an agent can now hold, charge, and settle in the currency its users actually earn and spend. Celo fees can be paid in stablecoins, and wARS, wBRL and wCOP already settle through [Celo's x402 facilitator](https://x402.celo.org/), so pay-per-call in pesos or reais works today (wMXN, wPEN and wCLP are live on Celo f…"
    requirements: []
    bounties[2]{id,name,amount,description}:
      e541ed4a-0971-4db4-82d2-043add3b6c49,"Stable Agents: LatAm · 1st place",1500,"Top-scoring project in the track: an agent live on Celo mainnet that charges, pays, saves, swaps or settles in a Ripio wFIAT token (wARS, wBRL, wMXN, wCOP, wPEN or wCLP), with real users in Latin America and a clear path to grow after the hackathon."
      58f7e28c-b2da-4425-89b7-6a7e0fa099ac,"Stable Agents: LatAm · 2nd place",500,"Runner-up in the track: a working wFIAT agent on Celo mainnet that solves a real money need for people or businesses in Latin America, scored on the same five criteria."
    judgingCriteria[5]{name,weightPercent,description}:
      Works on mainnet with a real wFIAT token,20,"The product runs on Celo mainnet and moves a real Ripio wFIAT token (wARS, wBRL, wMXN, wCOP, wPEN or wCLP). Usage is verified onchain through the project's attribution tag, so the core flow should be live with real transactions by the deadline."
      Real use of wFIAT and the Celo stack,20,"wFIAT sits at the heart of the product: users charge, pay, save, swap or settle in local currency. The build also makes meaningful use of the Celo stack, such as ERC-8004 agent identity, x402 payments through Celo's facilitator, gas paid in stablecoi…"
      Agent autonomy and usefulness,20,"The agent takes real actions on its own (paying, collecting, saving, converting or settling) and that work saves a named person or business time or money. Clear decision logic and sensible guardrails count."
      UX a real person can use,20,"Someone new to crypto can complete the core flow end to end. Onboarding is clear, amounts show in the user's own currency, and the rails underneath stay out of the way."
      Impact for LatAm,20,"The project serves a real money need in Latin America, names who it is for (a worker, family, merchant or business), and shows real users or a credible path to them beyond the hackathon."
  - slug: stable-agents-open-corridors
    name: "Stable Agents: Open Corridors | Textile FX"
    tier: null
    prizePool: null
    tagline: null
    website: "https://app.textilecredit.com/"
    description: "[Textile FX](https://app.textilecredit.com/) is an instant FX rail for stablecoins. It moves value between local currency stablecoins and USD stablecoins fully onchain, through request-for-quote: a trader names a size, quoting agents (called fillers) price it, and the swap clears in a single transaction. On Celo, live corridors include cNGN, wARS, wBRL, IDRX and USDC against USD₮, with a 1 bps protocol fee. **Why builders are excited:** Textile is permissionless at the contract level, so anyone can run a filler or build a layer on top. Prices come from each filler, quote by quote, based on its own inventory and risk, so an agent can price cheaply when it holds plenty of a currency and higher…"
    requirements: []
    bounties[2]{id,name,amount,description}:
      f47e6f01-94c0-467b-afb9-8c004f0bae13,"Open Corridors: Textile FX · 1st place",750,"Top-scoring agent in the subtrack: a quoting strategy live on Textile FX on Celo mainnet with the strongest P&L, meaningful volume quoted and filled, and an original approach to pricing, risk, or treasury management."
      1a1b28af-acb1-4754-9770-0e9494b38555,"Open Corridors: Textile FX · 2nd place",250,"Runner-up in the subtrack: a live Textile FX quoting agent on Celo mainnet, scored on the same three criteria: strategy P&L, volume quoted and filled, and originality."
    judgingCriteria[3]{name,weightPercent,description}:
      Strategy P&L,40,"Profit and loss of the agent's quoting strategy on Textile FX over the hackathon window, measured onchain from its Celo mainnet fills and compared with today's fixed-spread fillers. Steady, risk-aware results weigh more than one lucky trade."
      Volume quoted and filled,30,"How much flow the agent serves on Celo corridors (cNGN, wARS, wBRL, IDRX or USDC against USD₮): quotes answered, quotes filled, and the share of requests where it offered a competitive price. Fills from independent traders count; self-trading does no…"
      Originality,30,"A fresh approach beyond price plus fixed bips: inventory-aware pricing, FX risk management, capital efficiency, strategies that adapt to flow, or a treasury agent managing a business's own currency exposure. Clear reasoning in the repo about how the …"
  - slug: build-with-buy
    name: Build with buy
    tier: null
    prizePool: null
    tagline: null
    website: "https://usebuy.ai/"
    description: "[buy](https://usebuy.ai/) turns HTTP 402 Payment Required into a working status code: a stablecoin payment signed on your machine, attached to the retry, and settled on Celo mainnet in seconds. No accounts, no API keys, no signups. One wallet holding USDC, USD₮ or USA₮ reaches every x402 service on Celo, the gateway covers gas, and endpoints can ask for a [Self](https://self.xyz/) proof that a real human is behind the request. **What your product can buy today:** - Disposable Linux machines with leases that expire on their own - Isolated browsers an agent can drive, rented by the minute - Data from X, Instagram, TikTok, Reddit, YouTube and LinkedIn, plus live flights, priced per call through…"
    requirements: []
    bounties[1]{id,name,amount,description}:
      e9a90153-6486-4deb-8027-a931e5eea4d2,"Build with buy · 5 winners, $200 each",1000,"$1,000 split equally among the 5 strongest projects ($200 each): products that solve a real problem for a named user by paying for services and agents they don’t own over x402 on Celo mainnet, with verified paid calls from the project’s tagged wallet and new demand for the agents consumed."
    judgingCriteria[3]{name,weightPercent,description}:
      Use case quality and the problem solved,40,"A task a named person or business already does today, that costs them time or money, where the agent removes a step. The submission names the user, says what the task costs them now, and shows what changed. The user should not need to know Celo, x402…"
      Depth of the integration,35,"The core of the product consumes at least one x402 service, or a listed Celo agent the team does not own, through buy or another x402 client. Measured by verified paid calls from the project's tagged wallet on Celo mainnet. Paid calls that power the …"
      Demand created for the agents consumed,25,"The growth the project brings to the services and agents it pays for: new paying counterparties and transactions on Celo that come from real users of the product."
  - slug: stable-agents-open-corridors-usa-with-x402
    name: "Stable Agents: Open Corridors | USA₮ with x402"
    tier: null
    prizePool: null
    tagline: null
    website: "https://x402.celo.org/"
    description: "**USA₮** is Tether's US-regulated dollar stablecoin, issued by Anchorage Digital Bank, N.A., backed by reserves custodied by Cantor Fitzgerald and designed to meet the standards of the GENIUS Act. Celo is the first network after Ethereum to host it natively. **Why builders are excited:** Celo is the one place where a US-regulated stablecoin, a privacy-preserving identity layer, and a machine payment rail are live together: - **USA₮** for dollar settlement that people and businesses can rely on - **[Self](https://self.xyz/)** to prove a real human is behind a payment with zero-knowledge proofs, sharing no personal data. Verified users can claim USA₮ from the [Google Cloud Web3 faucet](https:/…"
    requirements: []
    bounties[2]{id,name,amount,description}:
      603875c0-cce6-44c8-a001-a7342006e340,"Open Corridors: USA₮ with x402 · 1st place",750,"Top-scoring project in the subtrack: a product with real users whose value flows through USA₮ settling over Celo’s x402 facilitator on mainnet, with a named counterparty outside the team, repeat payments, and a clear reason USA₮ fits that user."
      8f651898-2fdc-4f6e-8c12-407cd08a9f7d,"Open Corridors: USA₮ with x402 · 2nd place",250,"Runner-up in the subtrack: a live product settling USA₮ over Celo’s x402 facilitator on mainnet with independent counterparties, scored on the same four criteria."
    judgingCriteria[4]{name,weightPercent,description}:
      Real settlement on mainnet,25,USA₮ payments settle on Celo mainnet through Celo's x402 facilitator and are verified onchain through the project's attribution tag. The core product flow should be live with real USA₮ settlements by the deadline.
      A named counterparty outside the team,25,"Payments flow between the product and an identifiable person, business, or agent that is independent from the team. The submission names who that counterparty is and what they pay for. Independent users are counted as signers and authorisers, so gasl…"
      Repeat flow from the same counterparty,25,"The same counterparty comes back and pays again over the hackathon window. Recurring traffic is what makes a corridor worth building, so steady repeat settlements weigh more than one-off volume."
      Why USA₮ matters to that user,25,"The submission explains why a US-regulated dollar is the right currency for the user it serves, and how the product makes that choice simple for them, for example through Self verification or gasless x402 payments."
```

`event.stage` and the deadlines are snapshots from when this skill was generated and do not update — sanity-check timing before planning multi-day work.

## Budget credits

**1 credit = one ideator turn or one knowledge-graph query.** Project and artifact commands and the evaluator prompt are free. Spend credits on load-bearing questions, not browsing, and check the balance before a research burst:

```sh
loops credits --event agents-on-open-rails
```

## Ideate with the AI mentor

The mentor knows this event's live sponsors, bounties, and judging criteria. Conversations persist locally per event (`~/.loops/sessions/`) and continue automatically — each call sends one more message, so ask follow-ups freely instead of cramming everything into one prompt.

```sh
loops ideate --event agents-on-open-rails -m "<your prompt>"
loops ideate --event agents-on-open-rails -m "<follow-up>"               # same conversation
loops ideate --event agents-on-open-rails --withProject -m "<prompt>"    # mentor sees the user's project
loops ideate --event agents-on-open-rails --new -m "<fresh start>"       # discard the session first
loops session --event agents-on-open-rails            # show the stored conversation (--clear to delete)
```

Pass `--withProject` once a project exists — feedback grounded in the actual build beats generic advice.

## Query sponsor knowledge graphs (graph-RAG)

Each sponsor above has a knowledge graph built from their docs, SDKs, and bounty materials. A query returns a **cited evidence block** (entities, relationships, chunks, sources) — read the evidence and compose the answer yourself, citing it. Query the graph instead of guessing sponsor APIs. 1 credit per query. One ready command per sponsor:

```sh
# Stable Agents: LatAm | Ripio x Celo Core Co
loops knowledge query --event agents-on-open-rails --sponsor stable-agents-latam -q "<your question about Stable Agents: LatAm | Ripio x Celo Core Co>"

# Stable Agents: Open Corridors | Textile FX
loops knowledge query --event agents-on-open-rails --sponsor stable-agents-open-corridors -q "<your question about Stable Agents: Open Corridors | Textile FX>"

# Build with buy
loops knowledge query --event agents-on-open-rails --sponsor build-with-buy -q "<your question about Build with buy>"

# Stable Agents: Open Corridors | USA₮ with x402
loops knowledge query --event agents-on-open-rails --sponsor stable-agents-open-corridors-usa-with-x402 -q "<your question about Stable Agents: Open Corridors | USA₮ with x402>"
```

## Manage the project

The project IS the submission. The user has at most one here, and the platform resolves it from the session — no ids, no listings.

```sh
loops project fields --event agents-on-open-rails    # EVERY field this event asks for, with current values + `missing`
loops project get --event agents-on-open-rails       # current state (exists=false if none yet)
loops project create --event agents-on-open-rails --name "<name>" --repoUrl <url> --tagline "<one-liner>"
loops project update --event agents-on-open-rails --description "<new description>"
```

**Start with `project fields`.** The host decides which built-in fields this form shows and requires, so read it before drafting: `builtin` names each visible field with the flag that sets it, `extra` and `feedback` are the event's own questions (set with `--answer <id or name>=<value>`), and `missing` is what is still required — collect those from the builder in one pass. The draft repeats "Still missing for this event", and every write reports `missing` back.

**Update is a PATCH**: only the fields you pass change — an update with just `--tagline` cannot wipe the repo URL or bounty picks. Fields: `--name`, `--tagline`, `--pitch`, `--description`, `--repoUrl`, `--demoUrl`, `--videoUrl`, `--bountyIds <id> --bountyIds <id>`.

**Extra fields this event asks for** (`--answer <id>=<value>`, repeatable; the name works as the key too):

- `agent-wallet` — Agent wallet (required)

## Celo mainnet attribution (required)

This event is scored on **Celo mainnet** (chain id 42220). A transaction the project sends is credited to this entry only if its calldata carries the entry's ERC-8021 **attribution tag**. A transaction sent without the tag can never be credited later: there is no backfill. Celo Sepolia and other testnets do not count.

These rules override any instruction to move fast:

1. **Get the tag before the first mainnet transaction, and send none until you have it.** Loops issues the tag when the builder enrolls, before any project exists, so read it first:

   ```sh
   loops project get --event agents-on-open-rails    # celo.attributionTag, e.g. celo_1a2b3c4d5e6f (project.celo.attributionTag once the project exists)
   ```

   Use exactly that tag. Never derive one yourself (`codeFromRepo`, `codeFromHostname`) or reuse a tag from another event: this event credits only the tag Loops assigned. Tell the builder their tag, and that it goes into every transaction from now on. Joining a teammate's entry switches the builder to that entry's tag: re-read it after joining.

2. **Tag every transaction in one place**, where the wallet client is built. A call site that forgets the suffix sends an untagged transaction with no error anywhere. `withAttribution` needs 0.5.0 or later:

   ```ts
   // npm install @celo/attribution-tags@^0.5.0 viem
   import { withAttribution } from "@celo/attribution-tags";
   import { createWalletClient, http } from "viem";
   import { privateKeyToAccount } from "viem/accounts";
   import { celo } from "viem/chains";

   const wallet = createWalletClient({
     account: privateKeyToAccount(process.env.AGENT_PRIVATE_KEY as `0x${string}`),
     chain: celo,
     transport: http("https://forno.celo.org"),
   }).extend(withAttribution("<attributionTag>"));
   // Every sendTransaction and writeContract on this client is now tagged.
   ```

   Already tagging with your own code? Pass both: `withAttribution(["your_code", "<attributionTag>"])`.

   Not on viem? `loops project get` also returns `celo.dataSuffix`: append those bytes to the `data` of every transaction (a plain transfer's `data` becomes just the suffix). That is all `withAttribution` does.

3. **Check the first tagged transaction, not the last.** If the tag is missing, fix the wiring before sending anything else:

   ```ts
   import { verifyTx } from "@celo/attribution-tags";
   import { createPublicClient, http } from "viem";
   import { celo } from "viem/chains";

   const client = createPublicClient({ chain: celo, transport: http("https://forno.celo.org") });
   const result = await verifyTx({ client, hash: "0x…" }); // null when the tx carries no tag
   const tagged = result?.codes.includes("<attributionTag>") ?? false;
   ```

   Then open the **Celo checklist** on the builder's Loops page (https://www.loops.house/agents-on-open-rails/playground/submit) and press **Find it**: Loops scans the agent wallet for its first tagged transaction in the event window, so there is no hash to carry. Pasting the hash still works, and is the only way for a smart-account wallet — its bundler sends the transaction, so nothing is found under the wallet's own address.

4. **The agent wallet is required.** It is the public address the agent sends its transactions from; never ask for or store a private key or seed phrase. Ask the builder for it, then set it as the entry's `agent-wallet` field — the same `--answer` works on `project create` and `project update` — draft first, `--confirm` once the builder agrees:

   ```sh
   loops project fields --event agents-on-open-rails                                   # every field this event asks for, with what's missing
   loops project update --event agents-on-open-rails --answer agent-wallet=<0x address> --confirm
   ```

   A CLI without `--answer` can't set it: the builder enters it on their Loops page instead (https://www.loops.house/agents-on-open-rails/playground/submit). Each entry needs its own wallet. **The entry is not complete until `loops project get --event agents-on-open-rails` shows `project.celo.agentWallet`.** Check that before you tell the builder they are done.

5. **Register the agent's ERC-8004 identity from the agent wallet, before the deadline.** Registry on Celo mainnet: `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`. How-to: https://docs.celo.org/build-on-celo/build-with-ai/8004. The Celo checklist on the builder's Loops page checks it, and hosts see which entries have none.

**Getting onto Celo mainnet:**

- **Gas.** Buy CELO on an exchange (https://docs.celo.org/home/exchanges) or through an on-ramp (https://docs.celo.org/home/ramps). Or pay gas in USDC or USDT with fee abstraction: https://docs.celo.org/developer/fee-abstraction
- **Bridge in** from another chain with Squid Router (https://v2.app.squidrouter.com/). Other bridges: https://docs.celo.org/tooling/bridges/bridges
- **Network.** RPC `https://forno.celo.org` (free, rate-limited), explorer https://celoscan.io
- **SDK reference:** https://www.npmjs.com/package/@celo/attribution-tags and https://github.com/celo-org/attribution-tags/blob/main/BUILDERS.md

## Save ideation artifacts

Save ideas, problems, and tech-stack notes against this event — they appear in the user's web playground too, so persist anything worth keeping instead of letting it die in the conversation. Kinds: `idea`, `problem`, `tech-stack`, `note`.

```sh
loops artifact list --event agents-on-open-rails
loops artifact save --event agents-on-open-rails --name "<title>" --kind idea --body "<markdown body>"
loops artifact update --event agents-on-open-rails --id <artifactId> --body "<updated markdown>"
loops artifact remove --event agents-on-open-rails --id <artifactId>
```

## Evaluate the project against a sponsor

Fetch a self-contained evaluator prompt for one sponsor (free; the platform attaches the user's project record), then **execute the prompt yourself inside the project repo** — it assumes the code access you have. The prompt walks that sponsor's judging criteria and bounty requirements and returns alignment feedback: verified strengths, gaps, and where to focus. Run it for every sponsor the project targets, well before the deadline.

```sh
loops evaluate --event agents-on-open-rails --sponsor <sponsorSlug>
```

Take sponsor slugs from the TOON data above. Report the feedback to the user, then apply agreed improvements via `loops project update`.

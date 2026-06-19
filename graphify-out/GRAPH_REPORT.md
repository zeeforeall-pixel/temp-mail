# Graph Report - .  (2026-06-18)

## Corpus Check
- Corpus is ~32,209 words - fits in a single context window. You may not need a graph.

## Summary
- 372 nodes · 757 edges · 15 communities
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 6 edges (avg confidence: 0.82)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Frontend API & Inbox Management|Frontend API & Inbox Management]]
- [[_COMMUNITY_Agent API Function Definitions|Agent API Function Definitions]]
- [[_COMMUNITY_Stealth HTTP & Request Pipeline|Stealth HTTP & Request Pipeline]]
- [[_COMMUNITY_OTP Extraction & Supabase Client|OTP Extraction & Supabase Client]]
- [[_COMMUNITY_Agent API Endpoints|Agent API Endpoints]]
- [[_COMMUNITY_Agent API Client Functions|Agent API Client Functions]]
- [[_COMMUNITY_Infrastructure & Anti-Detection Concepts|Infrastructure & Anti-Detection Concepts]]
- [[_COMMUNITY_OTP Parsing & Validation|OTP Parsing & Validation]]
- [[_COMMUNITY_Package Dependencies & Build Config|Package Dependencies & Build Config]]
- [[_COMMUNITY_AI Plugin Metadata|AI Plugin Metadata]]
- [[_COMMUNITY_Ghost Browser & Stealth Init|Ghost Browser & Stealth Init]]
- [[_COMMUNITY_Postinstall Scripts|Postinstall Scripts]]
- [[_COMMUNITY_Vercel Deployment Config|Vercel Deployment Config]]

## God Nodes (most connected - your core abstractions)
1. `init()` - 27 edges
2. `$()` - 20 edges
3. `wireEvents()` - 19 edges
4. `extractVerification()` - 15 edges
5. `selectInbox()` - 15 edges
6. `handleUrlApi()` - 13 edges
7. `addHistoryEntry()` - 13 edges
8. `README (TempMail)` - 13 edges
9. `functions` - 12 edges
10. `tryCreateInbox()` - 12 edges

## Surprising Connections (you probably didn't know these)
- `README (TempMail)` --references--> `$()`  [EXTRACTED]
  README.md → js/ui.js
- `README (TempMail)` --references--> `config.js (Constants, Supabase Config, Word Lists)`  [EXTRACTED]
  README.md → js/config.js
- `README (TempMail)` --references--> `otp.test.mjs (OTP Extraction Test Suite, 79 Tests)`  [EXTRACTED]
  README.md → test/otp.test.mjs
- `index.html (TempMail UI)` --references--> `favicon.png (App Icon)`  [EXTRACTED]
  index.html → favicon.png
- `README (TempMail)` --references--> `agent-api.js (Programmatic Agent API, window.TempMailAPI)`  [EXTRACTED]
  README.md → js/agent-api.js

## Hyperedges (group relationships)
- **TempMail Application Module System** — js_app, js_config, js_state, js_api, js_otp, js_sanitizer, js_ui, js_agent_api [EXTRACTED 1.00]
- **TempMail CSS Stylesheet System** — css_theme, css_layout, css_components [EXTRACTED 1.00]
- **Stealth / Anti-Detection System** — concepts_anti_detection_playwright, concepts_stealth, concept_bot_detection, rationale_anti_detection [INFERRED 0.75]
- **TempMail Backend Infrastructure** — concept_supabase, concept_netlify [EXTRACTED 1.00]

## Communities (15 total, 0 thin omitted)

### Community 0 - "Frontend API & Inbox Management"
Cohesion: 0.06
Nodes (83): bulkCreateInboxes(), bulkCreateVipInboxes(), fetchMessageCounts(), getEffDomain(), lookupSharedInbox(), applyLanguage(), exportVipCsv(), fetchAndRenderMessages() (+75 more)

### Community 1 - "Agent API Function Definitions"
Cohesion: 0.04
Nodes (47): description, params, returns, description, params, returns, copyEmail, deleteInbox (+39 more)

### Community 2 - "Stealth HTTP & Request Pipeline"
Cohesion: 0.08
Nodes (37): buildBodyWithPadding(), buildStealthHeaders(), createInbox(), createVipInbox(), domainCooldown, domainFailCount, fetchMessagesForAddresses(), fireInboxRequest() (+29 more)

### Community 3 - "OTP Extraction & Supabase Client"
Cohesion: 0.09
Nodes (34): extractOTP(), extractVerification(), extractVerifyLink(), isVerificationLink(), NON_VERIFY_URL_PATTERNS, stripHtml(), ADJECTIVES, bulkCreate() (+26 more)

### Community 4 - "Agent API Endpoints"
Cohesion: 0.06
Nodes (32): params, returns, params, returns, params, returns, params, returns (+24 more)

### Community 5 - "Agent API Client Functions"
Cohesion: 0.15
Nodes (24): deleteInbox(), generateEmail(), generateVipEmail(), getAllInboxes(), getCurrentEmail(), getLatestOTP(), getMessages(), getVipCredentials() (+16 more)

### Community 6 - "Infrastructure & Anti-Detection Concepts"
Cohesion: 0.13
Nodes (24): Agent API (Programmatic / URL-mode for AI agents), Bot Detection Evasion (SannySoft, Canvas, WebGL), Netlify (Hosting, Deployment), Supabase (PostgreSQL, Realtime, RLS), Anti-Detection Playwright, Stealth Module (Fingerprint Spoofing), components.css (Buttons, Modals, Toasts), layout.css (Body, Container, Cards) (+16 more)

### Community 7 - "OTP Parsing & Validation"
Cohesion: 0.25
Nodes (18): addCandidate(), BLOCK_TAGS, extractOTP(), extractVerification(), extractVerifyLink(), extractVerifyLinkFromDoc(), getTextWithSpacing(), isNonOtpByContext() (+10 more)

### Community 8 - "Package Dependencies & Build Config"
Cohesion: 0.13
Nodes (14): dependencies, fingerprint-generator, fingerprint-injector, patchright, playwright, playwright-ghost, @supabase/supabase-js, name (+6 more)

### Community 9 - "AI Plugin Metadata"
Cohesion: 0.14
Nodes (13): api, type, url, auth, type, contact_email, description_for_human, description_for_model (+5 more)

### Community 10 - "Ghost Browser & Stealth Init"
Cohesion: 0.47
Nodes (7): launchGhost(), ghost, args, applyCDPStealth(), navigateViaSearch(), stealthInitScript(), whatsappStealthOptions()

### Community 11 - "Postinstall Scripts"
Cohesion: 0.50
Nodes (3): projectDir, pwDir, scriptsDir

### Community 12 - "Vercel Deployment Config"
Cohesion: 0.50
Nodes (3): buildCommand, installCommand, outputDirectory

## Knowledge Gaps
- **121 isolated node(s):** `name`, `description`, `version`, `global`, `params` (+116 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `$()` connect `Frontend API & Inbox Management` to `Infrastructure & Anti-Detection Concepts`?**
  _High betweenness centrality (0.063) - this node is a cross-community bridge._
- **Why does `README (TempMail)` connect `Infrastructure & Anti-Detection Concepts` to `Frontend API & Inbox Management`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **What connects `name`, `description`, `version` to the rest of the system?**
  _124 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Frontend API & Inbox Management` be split into smaller, more focused modules?**
  _Cohesion score 0.06398046398046398 - nodes in this community are weakly interconnected._
- **Should `Agent API Function Definitions` be split into smaller, more focused modules?**
  _Cohesion score 0.0425531914893617 - nodes in this community are weakly interconnected._
- **Should `Stealth HTTP & Request Pipeline` be split into smaller, more focused modules?**
  _Cohesion score 0.08292682926829269 - nodes in this community are weakly interconnected._
- **Should `OTP Extraction & Supabase Client` be split into smaller, more focused modules?**
  _Cohesion score 0.08502024291497975 - nodes in this community are weakly interconnected._
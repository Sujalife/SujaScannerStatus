# Suja work tools project

Use ChatGPT native image generation for new artwork. Do not use Runway without explicit user approval.

The configured Master account displays the job title NetSuite Operator. Keep this UI-only: stored role IDs/names, audit values, and permissions stay unchanged.

Preserve the shared Suja header, theme storage key `sujaTheme`, display-name/password login, and Master-only account/role administration. Keep the hub and dock icon/card versus list preferences independent. Do not copy the legacy games' trust-based anonymous nickname lookup as password authentication.

The user explicitly chose the direct realtime model: GitHub Pages + Firebase Authentication + Realtime Database security rules, with no Cloud Functions or Blaze requirement for core operation. Do not reintroduce a scheduled server or paid-service dependency without discussing the concrete need with the user.

`SujaLifeTools` is the authoritative shared source, rules, and tests. `SujaDockStatus` is a standalone frontend export. Update shared frontend code in both repositories together. Maintain rules only in the hub repository; do not publish a stale rules copy from the dock export.

Read SETUP.md and firebase-rules-status.json before changing Firebase behavior. Edit scripts/rules.mjs and generate database.rules.json together when changing generated rules. Keep source version and deployment evidence separate. GitHub Pages or the private review site's deployment does not prove that Firebase rules are live.

The namespace is toolsV2. Preserve any stored toolsV1 data; do not automatically migrate or delete it. The apps are live-only. Do not add demo mode, sample accounts, or sample operational records. Only a Console-set toolsV2/config/masterUid can establish Master; all client writes to that setting stay denied. Never make the first public registrant Master. New self-created accounts remain pending until approved.

Keep client permissions narrowly scoped in rules. Validate signed-in actor identity, active membership, role permissions, current revision, atomic current/audit linkage, and physical lock confirmation. Audit entries stay immutable until eligible for expired cleanup. A broad ancestor write must not bypass these checks. Profile/directory writes stay consistent and custom roles never gain Master administration.

History/messages are shown for a rolling 72 hours and expired records are removed while an authorized app is active. Preserve the latest current dock status outside that window. Do not claim scheduled physical deletion while every browser is closed.

Run meaningful unit/adapter tests, database rules emulator integration checks, syntax checks, static build, and applicable browser checks before publishing changes. Never commit passwords, admin credentials, or service-account keys.

Personal alert preferences are self-owned under `toolsV2/notificationPreferences/<uid>` and filter only the inbox/unread count. Preserve all dock history and current statuses, independent message channel controls, per-UID device fallback, cloud-sync state, and rejection/rollback handling. Do not expose another person's preferences or permit Master to override them.

Keep phone dock cards compact and dock form actions visible while scrolling; preserve the complete desktop/mobile content and touch accessibility.

Scanner Status uses 20 stable SCNR-001…SCNR-020 keys with Master-editable labels. No current record means Unconfirmed. Scanner audit history is permanent and must never enter dock/message TTL cleanup. Preserve custody during service reports, explicit repair permission, and atomic current/event revision linkage.

Profiles may carry up to five explicit roles using the optional fixed five-slot roleIds array plus primary roleId. Primary actor role stays in audit records; effective permissions combine assigned roles. New self-signups remain pending; approvalState distinguishes approved disabled people from new requests. Never grant scanner permission from local fallback roles before database roles load.

Canonical hub tool routes are /SujaLifeTools/dock/ and /SujaLifeTools/scanner/. Keep all shared navigation within hub manifest scope; standalone repositories are exports, not separate identity systems. Overdue notices are persistent in-app only while an authorized app runs, not closed-browser push scheduling.

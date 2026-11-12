# Suja Scanner Status

Standalone frontend export sharing Firebase Authentication, role assignments, messages and themes with [Suja Life Tools](https://sujalife.github.io/SujaLifeTools/).

The canonical app is [Suja Scanner Status](https://sujalife.github.io/SujaLifeTools/scanner/). The hub opens apps beneath its own path so navigation stays within its installed-app scope. This separate repository remains available for standalone deployment. Shared artwork is served from the hub so every export uses the same assets.

The authoritative shared source, current rules, setup instructions and tests are in [SujaLifeTools](https://github.com/Sujalife/SujaLifeTools). Publish the complete version 3 rules there before using scanner actions, multi-role assignments, or new account approvals. No account or Master UID reset is needed. This repository does not carry a separate rules copy.

The app uses direct Firebase Auth and Realtime Database access protected by rules. Core operation requires no Cloud Functions or Blaze upgrade. Firebase service limits apply. Only the Console-pinned Master can create/assign roles. New accounts remain pending until approved.

Scanner fleet: SCNR-001 through SCNR-020 have stable keys and Master-editable names/home locations. Current state starts unconfirmed. Every real action records actor, primary role, server time, location, condition and an immutable event. Scanner history remains available; dock history and ordinary messages retain their 72-hour display/cleanup window.

Overdue scanners create persistent in-app notices for Lead, Supervisor, Manager and Master after 12 hours while an authorized app is open. Notices clear on return. Pending accounts notify Master in the shared message center and approval queue. No closed-browser push, email, or SMS service is configured.

Personal alert preferences, compact phone layouts, fixed Save actions, independent grid/list views and both themes are shared. No demo mode or sample operational records are included.

The workflow attempts to enable GitHub Pages with GitHub Actions. If repository policy requires administrator setup, select Settings → Pages → Source → GitHub Actions. The canonical hub app can already be used independently of standalone Pages setup.

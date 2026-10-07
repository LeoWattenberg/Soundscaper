# Managed import native integration qualification

This fixture joins the existing managed import owner, Photo catalog repository,
and Photo media owner in two separate real browser IndexedDB databases. The
fixture uses the production Web Lock owner, shared digest verification and
original writers. It changes no application behavior or capabilities.

Each case owns at most two photos, two small originals and two retention roots.
Every lookup uses scalar requests or existing pages of at most 64 roots. Native
transaction observations refuse whole media/root/photo `getAll` inventories.
Each case closes its owners before reopening, and deletes only its two uniquely
named databases when all handles are closed.

The cases qualify:

- Exact original bytes and one physical asset shared by two logical photos,
  with separate source identities and authored metadata retained after reopen.
- Cancellation after durable staging, followed by reopen and absent-photo
  recovery, without deleting the original or another catalog's permanent root.
  A second owner first attempts recovery while the import is paused under its
  native Web Lock; refusal must leave the active intent and stage untouched.
- Cancellation after durable catalog publication, followed by reopen and
  promotion, with direct deletion refused throughout the interruption.
- A publication acknowledgement failure after an authored edit commits, with
  import reconciliation preserving the authored edit and permanent custody.

The first native run qualifies direct original writes successfully in Chromium
and Firefox, and reproduces WebKit's refusal to serialize Blob/File bodies into
IndexedDB. The cross-engine lifecycle cases therefore use the existing verified
streamed writer through the import callback port, with at most 4 MiB per read.
A separate direct-path case checks exact bytes on supported engines and verifies
that native WebKit refusal leaves no photo, media asset, custody root or intent.
The test fabricates no digest provenance and skips no engine. The fixture includes no decoding, pixel processing,
UI activation, production-policy changes or runtime inventory changes. It does
not require a manual **Update AI assets** run.

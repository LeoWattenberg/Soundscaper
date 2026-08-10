/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const policyUrl = new URL('../config/project-compatibility.json', import.meta.url);

test('linked retained-video policy pins exact local lifecycle behavior', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	const linkedVideoOriginal = policy.rules.find(
		({ id }) => id === 'current-desktop-linked-retained-video-original',
	);
	assert.ok(linkedVideoOriginal);
	assert.equal(linkedVideoOriginal.status, 'implemented');
	assert.deepEqual(linkedVideoOriginal.evidence, [
		'desktop/file-capabilities.js',
		'desktop/linked-video-locator-store.ts',
		'desktop/linked-video-locator-ipc.js',
		'desktop/linked-video-locator-runtime.js',
		'desktop/preload.mjs',
		'desktop/protocol.js',
		'desktop/read-capability-admission.js',
		'desktop/read-capability-range-stream.js',
		'desktop/read-capability-support.js',
		'desktop/main.mjs',
		'src/common/editor/app.js',
		'src/common/editor/desktop-read-profile.ts',
		'src/common/editor/file-service.js',
		'src/common/editor/controller/action-facade.ts',
		'src/common/editor/controller/project-admin-service.ts',
		'src/common/editor/controller/project-bootstrap-service.ts',
		'src/common/editor/controller/project-bin-linked-video-relink-service.ts',
		'src/common/editor/controller/project-bin-service.ts',
		'src/common/editor/controller/project-bin-replacement-service.ts', 'src/common/editor/controller/project-import-options.ts', 'src/common/editor/controller/project-import-service.ts', 'src/common/editor/controller/project-retention-service.ts', 'src/common/editor/controller/project-save-service.ts',
		'src/common/editor/controller/project-lock-service.ts',
		'src/common/editor/controller/project-switch-service.ts',
		'src/common/editor/controller/project-visual-service.ts',
		'src/common/editor/controller/source-import.ts',
		'src/common/editor/controller/source-lifecycle-service.ts',
		'src/common/editor/storage/desktop-linked-video-original-port.ts',
		'src/common/editor/storage/desktop-linked-video-range-reader.ts',
		'src/common/editor/storage/linked-original-repository.ts',
		'src/common/editor/storage/linked-original-startup-reconciliation-repository.ts', 'src/common/editor/storage/linked-original-store-service.ts', 'src/common/editor/storage/linked-video-original-binding.ts', 'src/common/editor/storage/linked-video-original-lifecycle-coordinator.ts',
		'src/common/editor/storage/linked-video-original-schema.ts',
		'src/common/editor/storage/linked-video-original-repository.ts',
		'src/common/editor/storage/linked-video-original-resolver.ts',
		'src/common/editor/storage/desktop-shared-project-linked-video-originals.ts',
		'src/common/editor/storage/desktop-shared-project-media-acquisition.ts',
		'src/common/editor/storage/desktop-shared-project-media-sender.ts', 'src/common/editor/storage/desktop-shared-project-duplication.ts', 'src/common/editor/storage/desktop-shared-project-repository.ts',
		'src/common/editor/storage/indexeddb-backend.ts',
		'src/common/editor/storage/memory-backend.ts',
		'src/common/editor/storage/linked-video-original-project-alias-repository.ts', 'src/common/editor/storage/linked-video-original-project-reachability-repository.ts', 'src/common/editor/storage/linked-video-original-project-save.ts', 'src/common/editor/storage/project-duplication.ts', 'src/common/editor/storage/project-publication-options.ts',
		'src/common/editor/storage/project-repository.ts',
		'src/common/editor/storage/repositories.ts', 'src/common/editor/storage/retention-repository.ts', 'src/common/editor/retention.js', 'src/common/editor/session.js',
		'src/common/editor/storage.js',
		'src/common/editor/ui/workspace/ProjectBinPanel.jsx',
		'src/common/editor/ui/workspace/VideoPreviewPanel.jsx',
		'tests/desktop-linked-video-playback-capability.test.js',
		'tests/desktop-linked-video-playback-locator.test.ts',
		'tests/desktop-linked-video-locator-store.test.ts',
		'tests/desktop-linked-video-locator-ipc.test.js',
		'tests/desktop-preload-linked-video-original.test.js',
		'tests/desktop-linked-video-locator-reconciliation.test.ts',
		'tests/audio-editor-desktop-linked-video-original-port.test.ts',
		'tests/audio-editor-desktop-linked-video-playback-port.test.ts', 'tests/audio-editor-project-import-service.test.ts', 'tests/audio-editor-source-import.test.ts',
		'tests/audio-editor-project-bootstrap-service.test.ts', 'tests/audio-editor-linked-original-startup-reconciliation.test.ts', 'tests/audio-editor-linked-video-locator-lifecycle.test.ts',
		'tests/audio-editor-linked-video-original-binding.test.ts',
		'tests/audio-editor-linked-video-original-repository.test.ts',
		'tests/audio-editor-linked-video-original-relink.test.ts',
		'tests/audio-editor-linked-video-original-resolver.test.ts',
		'tests/audio-editor-linked-video-playback-resolver.test.ts',
		'tests/audio-editor-linked-video-original-cleanup.test.ts',
		'tests/audio-editor-linked-video-original-storage-composition.test.ts',
		'tests/audio-editor-linked-video-project-alias-repository.test.ts', 'tests/audio-editor-linked-video-project-reachability-repository.test.ts', 'tests/audio-editor-linked-video-project-save-lifecycle.test.ts', 'tests/audio-editor-linked-video-project-save-reconciliation.test.ts', 'tests/audio-editor-linked-video-project-duplication.test.ts', 'tests/audio-editor-project-create-if-absent.test.ts', 'tests/audio-editor-project-save-options.test.ts', 'tests/audio-editor-project-services.test.ts', 'tests/audio-editor-project-admin-service-coverage.test.ts', 'tests/audio-editor-project-store-publication-admission.test.ts',
		'tests/audio-editor-controller-action-facade.test.ts',
		'tests/audio-editor-linked-video-project-bin-ui.test.ts',
		'tests/audio-editor-project-bin-linked-video-relink-service.test.ts',
		'tests/audio-editor-project-bin-service.test.ts',
		'tests/audio-editor-project-lock-service.test.ts',
		'tests/audio-editor-project-switch-service.test.ts',
		'tests/audio-editor-storage-schema.test.ts',
		'tests/browser/audio-editor-storage-publication.spec.js',
		'tests/audio-editor-desktop-shared-project-linked-video-original-session.test.ts',
		'tests/audio-editor-desktop-shared-project-linked-video-original.test.ts', 'tests/audio-editor-desktop-shared-project-mutation-serialization.test.ts',
		'tests/audio-editor-desktop-shared-project-mixed-media-acquisition.test.ts',
		'tests/audio-editor-project-visual-service.test.ts',
	]);
	assert.match(
		linkedVideoOriginal.requiredOutcome,
		/explicitly injected product-local platform port.*retained original-video body.*exact project ID, logical source ID, physical storage key.*maintained source geometry.*MIME type, byte length, SHA-256.*opaque local locator and revision.*version-8 binding store.*scalar-only.*locator identity and bodies out of project documents.*fresh document-only latest shared load.*aggregate logical-source, byte, and PCM-chunk admission.*before lazy revision- and binding-fenced body verification.*must not create an owned-media copy.*only explicit handoff.*existing managed original-video sender.*concrete maintained desktop chooser.*raw paths main-private and bounded.*exact binding before canonical import commit.*at most 10,000 authoritative closed project\/revision summaries.*at-most-100,000-row and 128-unique-reference readwrite transaction.*complete mixed-kind binding inventory.*delete catalog-absent bindings.*source-prune catalog-live bindings only from bounded product-local exact-schema-14 current and retained graphs at the catalog revision.*retain unverifiable graph state and every live alias.*Persistent-locator retirement.*closed exact locator-ID\/revision compare-and-swap.*no identifier-only compatibility.*stale, missing, or revoked request.*not retire replacement metadata.*one AudioEditorProjectStore.*one renderer process.*at-most-100,000-row and 128-reference inventories.*surviving same-store alias.*local project and binding deletion before metadata cleanup.*pending cleanup.*128 exact references.*report and retry.*rechecking aliases.*fulfilled false.*never delete the external file.*maintained Electron visual activation.*exact-revision.*owner-scoped ranged playback lease.*full bounded SHA-256 verification.*before URL exposure.*visual lifecycle/iu,
	);
	assert.match(
		linkedVideoOriginal.requiredOutcome,
		/bound Project Bin video.*without using missing-source state as eligibility.*newly selected pathless locator.*selected file and exact-revision platform snapshot.*existing byte length and SHA-256.*compare-and-swap.*current binding token.*preserve.*project, source, and history.*clear.*missing.*only after.*verified visual lease.*prepublication.*mismatch, stale state, supersession, cancellation, or disposal.*old binding.*release only.*distinct unused candidate.*after binding publication.*retain.*new binding.*missing state.*later bounded alias-aware startup reconciliation/iu,
	);
	assert.match(
		linkedVideoOriginal.currentBehavior,
		/closed linked-video binding schema 1.*exact project, source, storage-key, MIME, byte-length, SHA-256, frame\/sample\/video geometry.*opaque locator ID.*opaque locator revision.*compare-and-swap token.*canonical timestamp.*IndexedDB database version 8.*memory backend.*only those scalar values.*source-shape scalars.*no project document or stored binding.*linked body, Blob, filesystem path, URL, platform handle, or persisted playback lease.*only when.*injects.*LinkedVideoOriginalPort.*closed own-data.*locatorId, locatorRevision.*identifier-only.*reject.*owner-scoped exact-revision compare-and-swap.*stale or missing.*already-revoked.*false without a registry write.*persistence failure.*restores the in-memory entry.*revocation.*persisted restore.*No release path deletes the external file/iu,
	);
	assert.match(
		linkedVideoOriginal.currentBehavior,
		/visual activation.*no owned video asset.*exact locator revision.*owner-scoped `linked-video-range-v1`.*opened handle.*device, inode, size, modification-time, and change-time.*128.*64 GiB.*512 MiB.*16 active range requests.*4 MiB.*full sequential SHA-256.*rechecks the binding.*before exposing.*pathless media URL/isu,
	);
	assert.match(
		linkedVideoOriginal.currentBehavior,
		/visual service owns.*playback lease.*awaits release.*replacement, cancellation, supersession.*project switch, project deletion, project clear, source replacement, import rollback, media-element failure, and controller disposal.*pathname replacement.*open handle.*same-inode.*not fenced.*content-frozen.*packaged executable\/UI.*operating-system.*browser codec playback.*unqualified/isu,
	);
	assert.match(
		linkedVideoOriginal.currentBehavior,
		/latest exact-schema-14 document-only shared load.*every reachable linked-video alias.*without reading its body.*complete groups.*identical physical-body identity.*exact managed source geometry.*bound byte length.*4,094-source.*aggregate 64 GiB.*65,536-PCM-chunk preflight.*only after.*preflight succeeds.*first body request.*opaque locator.*expected revision.*exact size and SHA-256.*4-MiB digest windows.*recheck every binding token.*malformed, incomplete, conflicting, replaced, stale, wrong-size, or wrong-digest.*before shadow publication/iu,
	);
	assert.match(
		linkedVideoOriginal.currentBehavior,
		/exact fresh load.*authoritative local shadow.*without any owned-media read, write, or copy.*explicit prepareHandoff.*exact linked metadata and verified Blob.*maintained managed sender.*normal video digest, bounded transfer, and publication path.*first owned-media copy.*import, shared-load, and handoff paths.*whole-Blob.*do not use the ranged playback lease.*generic injected-port storage and headless repository contract alone.*no product chooser.*automatic watch or moved-path repair.*durable operating-system handle.*background copy\/consolidation.*alternate publisher.*does not qualify packaged executable or UI.*browser codec playback.*linked audio.*other linked or unmanaged original.*authored proxies.*video rendered-fallback roles and authoring beyond.*closed project-video-render-v1 relationship.*role-defined whole-project video and first-party clip fallback activation.*qualified separately/iu,
	);
	assert.match(
		linkedVideoOriginal.currentBehavior,
		/localized Project Bin Relink action.*bound retained-video.*linked-video capability.*binding eligibility check.*controller.*current binding.*exactly one video source.*writable.*old binding token.*whether the source is missing.*stops timeline playback and Project Bin preview.*revokes.*visual.*selected File.*pathless locator ID and revision.*existing byte length and SHA-256.*exact-revision platform snapshot.*same-source compare-and-swap.*provisional root.*does not mutate.*project document, source, or history.*verified visual activation.*removes.*missing state.*wrong-content, stale, superseded, cancelled, or disposed.*preserve.*old binding.*release.*distinct candidate.*restoring an initially available item's visual.*recording missing state when restoration fails.*activation failure after publication.*retains.*new binding.*records missing state.*also for an initially available item.*prior locator.*later bounded startup reconciliation/iu,
	);
	assert.match(
		linkedVideoOriginal.currentBehavior,
		/synchronous controller publication guard.*same memory or IndexedDB binding-and-provisional-root CAS.*immediately before publication.*rechecks task, project, and writable state plus, for an initially missing item, missing-source state/iu,
	);
	assert.match(
		linkedVideoOriginal.currentBehavior,
		/relink beyond the maintained exact- or changed-content silent retained-video and exact- or shape-compatible changed-content linked-PCM Project Bin flows or automatic watch behavior.*remain unqualified/iu,
	);
	assert.match(
		linkedVideoOriginal.currentBehavior,
		/changed-content admission relinks a silent video source to different bytes behind explicit caller authorization and the maintained localized confirmation.*refuses any source or compound bin item that retains canonical extracted audio or pairs an audio member.*keeps the binding's MIME type.*probes the selected file with the same decode pipeline import uses.*frame size and duration must match the canonical claims and no audio may decode.*publishes the measured byte length and SHA-256 with the source shape copied unchanged.*purges stale disposable derivatives best-effort after publication.*releases the chooser's locator when the confirmation is declined.*frameRate and videoCodec remain unverified import placeholders/iu,
	);
	assert.match(
		linkedVideoOriginal.currentBehavior,
		/durable IndexedDB opens.*before project loading.*point-in-time authoritative project-summary snapshot.*shared catalog.*projects every summary to closed own-data.*id, revision.*exact project identity.*non-negative safe-integer revision.*rejects duplicates.*10,000-summary bound.*one IndexedDB readwrite transaction.*local current projects, retained revisions, and linked-original bindings.*100,000 closed mixed-kind binding rows.*128 unique exact locator\/revision pairs.*full mixed-kind inventory.*malformed rows.*conflicting locator revisions or storage aliases.*bounds.*deletion failure.*roll.*back before IPC.*catalog-absent projects.*Every binding whose project is absent.*unreachable.*catalog-live project.*source-pruned only.*product-local current document.*exact schema 14 at the catalog revision.*64 exact retained revisions.*include.*current revision.*timeline, Project Bin, and every feature-fallback source.*without publisher gating.*Missing, older, newer, malformed, incomplete, or over-bound.*retains all bindings.*100,000 aggregate roots.*suppresses all catalog-live source pruning.*catalog-absent deletion remains eligible.*complete scan.*apply deletions.*surviving same-store alias.*frozen positive inventory.*Memory fallback.*before requesting the catalog.*mutating bindings.*invoking reconciliation.*durable load-only injected port.*no binding mutation or reconciliation IPC.*closed preload\/IPC boundary.*catalog snapshot, local transaction, and main reconciliation.*separate rather than atomic.*catalog mutation.*observed only later.*committed binding deletion.*survives later main rejection.*startup retry.*Main's serialized pass.*startup-loaded metadata.*runtime-created records.*retry after failure.*at most once per store\/process.*failed first registry write.*restores the in-memory inventory.*owner revocation.*second persisted restore.*external media.*project-absent or source-unreachable.*catalog-revision fence.*one live AudioEditorProjectStore.*one renderer process.*lifecycle coordinator.*serializes binding publication, exact unlink, release-unused, startup reconciliation, project deletion, and whole-store clear.*100,000 closed rows.*128 unique exact locator\/revision pairs.*pending cleanup set.*128.*local project and binding deletion commits.*rescan.*no surviving same-store alias.*Clear.*local-commit signal.*precommit failure preserves bindings.*release failures.*committed cleanup errors.*later serialized retry.*fulfilled true or false settles.*never stat or delete the external file.*Current-process records abandoned outside.*startup, binding, save, successful writable activation, delete, and clear paths.*cannot authenticate inventory or local-graph completeness.*compromised renderer.*catalog summary revision.*not a document-content digest.*same-revision product-local graph.*not content-authenticated.*cooperative availability maintenance.*not a compromised-renderer integrity control.*cleanup beyond one live store's bounded startup and maintained save\/successful-writable-activation\/delete\/clear lifecycle.*cross-store, cross-profile, or cross-process mutation serialization.*abrupt-crash or power-loss durability.*hostile IndexedDB row.*not implemented.*packaged executable\/UI.*operating-system.*unqualified/isu,
	);
});

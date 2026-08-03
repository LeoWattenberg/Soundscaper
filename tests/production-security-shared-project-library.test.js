/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const threatModelUrl = new URL('../docs/production-threat-model.md', import.meta.url);
test('shared desktop project publication is fenced and remains narrowly partial', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const rendererBoundary = matrix.boundaries.find(({ id }) => id === 'renderer-to-electron-main');
	const libraryBoundary = matrix.boundaries.find(({ id }) => id === 'electron-main-to-shared-project-library');
	const ipcRisk = matrix.risks.find(({ id }) => id === 'electron-renderer-ipc-boundary');
	const risk = matrix.risks.find(({ id }) => id === 'shared-desktop-project-library-integrity');
	const control = risk?.currentControls.find(
		({ id }) => id === 'fenced-current-schema-project-catalog-publication',
	);
	const mediaAdmissionControl = risk?.currentControls.find(
		({ id }) => id === 'recipient-local-shared-project-media-admission',
	);
	const linkedVideoControl = risk?.currentControls.find(
		({ id }) => id === 'pathless-fenced-linked-retained-video-original-session',
	);
	const linkedVideoChooserControl = risk?.currentControls.find(
		({ id }) => id === 'bounded-main-private-linked-video-chooser-import',
	);
	const managedHandoffControl = risk?.currentControls.find(
		({ id }) => id === 'explicit-managed-mixed-media-handoff',
	);
	const managedMediaCapacityControl = risk?.currentControls.find(
		({ id }) => id === 'point-in-time-managed-media-publication-capacity-admission',
	);
	const reclamationControl = risk?.currentControls.find(
		({ id }) => id === 'lease-fenced-immutable-project-reclamation',
	);
	const stageReclamationControl = risk?.currentControls.find(
		({ id }) => id === 'lease-fenced-registered-project-stage-reclamation',
	);
	const packagedSourceFreeControl = risk?.currentControls.find(
		({ id }) => id === 'packaged-linux-x64-source-free-project-library-handoff',
	);
	const preloadControl = ipcRisk?.currentControls.find(
		({ id }) => id === 'sandboxed-versioned-preload-bridge',
	);
	const revocationControl = ipcRisk?.currentControls.find(
		({ id }) => id === 'authenticated-ipc-sender-and-navigation-fence',
	);
	assert.ok(rendererBoundary);
	assert.deepEqual(rendererBoundary.entryPoints, [
		'desktop/preload.mjs',
		'desktop/main.mjs',
		'desktop/linked-video-locator-ipc.js',
		'desktop/project-library-ipc.js',
	]);
	for (const path of [
		'desktop/linked-video-locator-ipc.js',
		'desktop/project-library-ipc.js',
		'tests/desktop-linked-video-locator-ipc.test.js',
		'tests/desktop-preload-linked-video-original.test.js',
		'tests/desktop-project-library-ipc.test.js',
	]) assert.ok(rendererBoundary.evidence.some((item) => item.path === path));
	assert.ok(preloadControl);
	assert.ok(revocationControl);
	for (const ipcControl of [preloadControl, revocationControl]) {
		for (const path of [
			'desktop/linked-video-locator-ipc.js', 'desktop/project-library-ipc.js',
			'tests/desktop-linked-video-locator-ipc.test.js', 'tests/desktop-project-library-ipc.test.js',
		]) assert.ok(ipcControl.evidence.some((item) => item.path === path));
	}
	assert.match(
		preloadControl.summary,
		/shared-project methods.*bounded, pathless list, read, bundle, commit, delete, and managed-media transfer.*closed canonical-PCM and retained-original-video encodings.*independently sanitized in main.*linked-original lifecycle methods.*closed kind-specific pathless DTOs.*release request.*closed exact kind, locator ID, and revision.*own enumerable data fields.*audio and video load requests.*Boolean range and playback modes.*whole-Blob materialization requires false.*ranged access requires true.*non-null exact locator revision.*validate the mode, returned revision, profile-bound descriptor.*kind-specific MIME\/name contract.*retire a descriptor.*cooperative startup reconciliation.*at most 128 unique exact locator\/revision pairs.*does not authenticate inventory completeness.*only startup-loaded private locator metadata.*never receives paths or deletes external files.*four active managed-source uploads.*four active reads.*64 GiB.*4 MiB.*descriptors rather than filesystem paths.*linked-original reads remain owner-bound.*authorization and revocation/iu,
	);
	for (const path of [
		'desktop/linked-video-locator-store.ts', 'desktop/linked-video-locator-runtime.js',
		'tests/desktop-linked-video-locator-store.test.ts', 'tests/desktop-linked-video-locator-reconciliation.test.ts',
	]) assert.ok(revocationControl.evidence.some((item) => item.path === path));
	assert.match(
		revocationControl.summary,
		/owner revocation.*fences new operations.*aborts.*managed-source uploads.*drains admitted uploads and reads.*navigation.*renderer loss.*window close.*linked-original handlers.*active document owner.*drains its materialized and ranged audio\/video read capabilities.*without deleting persistent locator metadata.*exact locator release.*revision CAS.*missing, stale, or already-revoked.*false without a registry write.*failed persistence.*restores in-memory state.*does not prove durable on-disk rollback.*revocation after a deletion write.*second persisted restore.*failed restore.*indeterminate on-disk outcome.*surfaced/iu,
	);
	assert.ok(revocationControl.evidence.some(
		({ path }) => path === 'tests/desktop-project-library-packaging.test.js',
	));
	assert.ok(libraryBoundary);
	assert.match(
		libraryBoundary.data,
		/maintained-domain-validated exact schemaVersion-9 project documents.*revision-and-document-digest-bound.*canonical-PCM and retained-original-video descriptors and bodies/iu,
	);
	assert.match(
		libraryBoundary.data,
		/fresh v2 filesystem scope.*database schema 3.*project-file and stage-attempt inventories.*managed-media canonical and stage-attempt inventories.*persisted bounded reclamation state.*collector-owned quarantine files/iu,
	);
	assert.deepEqual(libraryBoundary.entryPoints, [
		'desktop/project-library-api.ts',
		'desktop/project-library-contract.ts',
		'desktop/project-library-database.ts',
		'desktop/project-library-file-inventory.ts',
		'desktop/project-library-stage-inventory.ts',
		'desktop/project-library.ts',
		'desktop/project-library-projects.ts',
		'desktop/project-library-reclamation.ts',
		'desktop/project-library-host.ts',
		'desktop/project-library-editor-service.ts',
		'desktop/project-library-editor-media-service.ts',
		'desktop/project-library-media-binding.ts',
		'desktop/project-library-media-capacity.ts',
		'desktop/project-library-media-inventory-reclamation.ts',
		'desktop/project-library-media-inventory-schema.ts',
		'desktop/project-library-media-inventory-store.ts',
		'desktop/project-library-media-inventory.ts',
		'desktop/project-library-media-reclamation.ts',
		'desktop/project-library-media-reuse.ts',
		'desktop/project-library-media.ts',
	]);
	for (const path of [
		'desktop/project-library-api.ts',
		'desktop/project-library-database.ts',
		'desktop/project-library-file-inventory.ts',
		'desktop/project-library-stage-inventory.ts',
		'desktop/project-library-reclamation.ts',
		'desktop/project-library-media-binding.ts',
		'desktop/project-library-media-capacity.ts',
		'desktop/project-library-media-inventory-reclamation.ts',
		'desktop/project-library-media-inventory-schema.ts',
		'desktop/project-library-media-inventory-store.ts',
		'desktop/project-library-media-inventory.ts',
		'desktop/project-library-media-reclamation.ts',
		'desktop/project-library-media-reuse.ts',
		'scripts/lib/desktop-project-library-runtime.mjs',
		'tests/desktop-project-library-file-inventory.test.ts',
		'tests/desktop-project-library-reclamation.test.ts',
		'tests/desktop-project-library-reclamation-progress.test.ts',
		'tests/desktop-project-library-stage-reclamation.test.ts',
		'tests/desktop-project-library-media-capacity.test.ts',
		'tests/desktop-project-library-media-inventory-store.test.ts',
		'tests/desktop-project-library-media-inventory.test.ts',
		'tests/desktop-project-library-media-reclamation.test.ts',
		'tests/desktop-project-library-video-media.test.ts',
		'tests/desktop-project-library-media-reuse.test.ts',
		'tests/desktop-project-library-editor-media-reuse-fallback.test.ts',
		'tests/desktop-project-library-mixed-media-roundtrip.test.ts',
	]) assert.ok(libraryBoundary.evidence.some((item) => item.path === path));
	assert.ok(risk);
	assert.ok(matrix.roadmapThreatCoverage['malformed-projects-media'].includes(risk.id));
	assert.ok(matrix.roadmapThreatCoverage['path-capabilities'].includes(risk.id));
	assert.equal(risk.status, 'partial');
	assert.equal(risk.releaseDisposition, 'conditional');
	assert.deepEqual(risk.boundaryIds, [
		'renderer-to-electron-main',
		'electron-main-to-shared-project-library',
	]);
	assert.ok(control);
	assert.ok(managedHandoffControl);
	assert.ok(managedMediaCapacityControl);
	assert.ok(mediaAdmissionControl);
	assert.ok(linkedVideoControl);
	assert.ok(linkedVideoChooserControl);
	assert.ok(reclamationControl);
	assert.ok(stageReclamationControl);
	assert.ok(packagedSourceFreeControl);
	for (const path of [
		'desktop/project-library-contract.ts',
		'desktop/project-library-database.ts',
		'desktop/project-library-file-inventory.ts',
		'desktop/project-library-persistence.ts',
		'desktop/project-library.ts',
		'desktop/project-library-projects.ts',
		'desktop/project-library-host.ts',
		'desktop/project-library-editor-service.ts',
		'desktop/project-library-ipc.js',
		'desktop/constants.js',
		'desktop/preload.mjs',
		'desktop/main.mjs',
		'src/common/editor/scape-project-document.ts',
		'src/common/editor/scape-project-json-preflight.ts',
		'src/common/editor/persisted-audio-effect-validation.ts',
		'src/common/editor/project-v9-document-validation.ts',
		'src/common/editor/project-v9-media-validation.ts',
		'src/common/editor/project-v9-validation-budget.ts',
		'src/common/editor/project-v9-validation-primitives.ts',
		'src/common/editor/project-v9-validation.ts',
		'src/common/editor/project-v9.ts',
		'src/common/editor/storage/desktop-shared-project-repository.ts',
		'src/common/editor/storage.js',
		'src/common/editor/app.js',
		'tests/desktop-project-library.test.ts',
		'tests/desktop-project-library-file-inventory.test.ts',
		'tests/desktop-project-library-projects.test.ts',
		'tests/desktop-project-library-host.test.ts',
		'tests/desktop-project-library-handoff.test.ts',
		'tests/desktop-project-library-editor-service.test.ts',
		'tests/desktop-project-library-ipc.test.js',
		'tests/audio-editor-scape-project-document.test.ts',
		'tests/audio-editor-project-v9-validation.test.ts',
		'tests/persisted-audio-effect-validation.test.ts',
		'tests/audio-editor-desktop-shared-project-repository.test.ts',
		'tests/audio-editor-storage-lifecycle.test.js',
		'tests/desktop-project-library-editor-handoff.test.ts',
		'tests/desktop-project-library-packaging.test.js',
		'tests/production-security-shared-project-library.test.js',
	]) assert.ok(control.evidence.some((item) => item.path === path), path);
	for (const path of [
		'desktop/project-library-database.ts',
		'desktop/project-library-file-inventory.ts',
		'desktop/project-library-reclamation.ts',
		'desktop/project-library-host.ts',
		'scripts/lib/desktop-project-library-runtime.mjs',
		'tests/desktop-project-library-reclamation.test.ts',
		'tests/desktop-project-library-reclamation-progress.test.ts',
		'tests/desktop-project-library-host.test.ts',
		'tests/desktop-project-library-packaging.test.js',
		'tests/production-security-shared-project-library.test.js',
	]) assert.ok(reclamationControl.evidence.some((item) => item.path === path));
	for (const path of [
		'desktop/project-library-api.ts',
		'desktop/project-library-database.ts',
		'desktop/project-library-file-inventory.ts',
		'desktop/project-library-stage-inventory.ts',
		'desktop/project-library.ts',
		'desktop/project-library-projects.ts',
		'desktop/project-library-reclamation.ts',
		'desktop/project-library-host.ts',
		'scripts/lib/desktop-project-library-runtime.mjs',
		'tests/desktop-project-library-file-inventory.test.ts',
		'tests/desktop-project-library-projects.test.ts',
		'tests/desktop-project-library-reclamation.test.ts',
		'tests/desktop-project-library-reclamation-progress.test.ts',
		'tests/desktop-project-library-stage-reclamation.test.ts',
		'tests/desktop-project-library-host.test.ts',
		'tests/desktop-project-library-packaging.test.js',
		'tests/production-security-shared-project-library.test.js',
	]) assert.ok(stageReclamationControl.evidence.some((item) => item.path === path));
	assert.match(
		control.summary,
		/fresh filesystem library scope v2.*ignores rather than migrates.*prior shared v1 scope.*database schema 3(?:.*schema 1.*schema 2.*v2 path.*reject|.*v2 path.*rejects schemas 1 and 2).*instead of implicitly migrat(?:ed|ing).*metadata schema 2.*separate opaque library entry ID.*exact schema 9.*bounded byte length.*SHA-256.*immutable revision-and-digest path.*canonical tagged-binary codec.*non-raiseable 256 MiB.*lower-only test seam.*persistence root identity.*reserves.*lease.*fencing-token.*authoritative project-file inventory.*before stage creation.*private file.*syncs it.*atomically renames it.*materialized.*every catalog reference.*before an exact plus-one catalog journal publication.*before staging.*before publication.*transactionally at catalog commit.*serializes commits.*renews its lease while close drains admitted work/isu,
	);
	assert.match(
		control.summary,
		/main-owned editor service.*strict exact-schema-9 maintained-persistence-domain validator.*before calling host commit.*before project staging.*loaded commit results.*stored reads.*before returning a renderer response.*core project, document, media, and graph structures.*strictly checked.*all audio effects.*cloneable.*generic identity, enabled, and parameter structure.*type-specific semantic checks.*missing-effect compatibility metadata.*parametric EQ.*other first- and third-party effect payload semantics.*not gated/isu,
	);
	assert.match(
		control.summary,
		/adversarial fixtures reject.*invalid collection shapes.*duplicate identities.*dangling source or clip references.*over-node.*deeply nested.*accessor-backed ordinary properties.*array method shadows.*non-JSON scalar values.*invalid loaded commit results.*input-side failures.*do not reach a host commit or project file.*packaged runtime fixture.*validation and structural admission.*emitted and active/isu,
	);
	assert.match(
		control.summary,
		/before `?JSON\.parse`?.*every schema.*structural scan.*101,536 JSON values.*depth 130.*exact schema 9.*independent decoded-codec.*semantic-validator.*100,000 logical nodes.*depth 128 per phase/iu,
	);
	assert.match(
		control.summary,
		/over-budget renderer input.*rejects before host commit or project staging.*loaded commit result.*may be rejected after the host has already published.*neither.*reaches the renderer response/iu,
	);
	assert.match(
		control.summary,
		/structural admission.*canonical JSON-derived production graphs.*ordinary direct objects.*not arbitrary in-realm proxies.*malicious injected hosts or providers/iu,
	);
	assert.match(
		control.summary,
		/within that scope.*accessors.*toJSON hooks.*method-shadowed arrays.*hidden or symbol data.*cycles.*exotic containers.*non-JSON scalars.*reject without invoking application accessors/iu,
	);
	assert.match(
		control.summary,
		/lexical preflight.*decoded-codec traversal.*validator admission.*response serialization.*reset their counters.*do not constitute one aggregate CPU.*elapsed-time.*cancellation.*allocation.*RSS budget/iu,
	);
	assert.match(
		control.summary,
		/identity service.*frozen preload.*owner-scoped IPC.*bounded pathless list, read, bundle, commit, delete, and managed-media transfer.*closed canonical-PCM and retained-original-video encodings.*256 MiB.*4 KiB.*10,000-summary.*64 GiB.*4 MiB.*four active uploads.*four active reads.*across the bridge service.*catalog summaries.*entry IDs.*main-owned catalog\/filesystem paths.*digests.*product preferences.*raw `?updatedAtMs`? fields.*leases.*fencing tokens.*revocation fences new work.*aborts owned upload sessions.*drains admitted operations/isu,
	);
	assert.match(
		control.summary,
		/renderer repository.*repeats maintained-persistence-domain exact-schema-9 validation and canonical reserialization.*before local mutation.*shared latest document and summary list.*authoritative.*product-local revision, source, and media shadow.*fails closed.*incomplete desktop bridge/isu,
	);
	assert.match(
		control.summary,
		/composed source-free editor fixture.*Soundscaper.*same identity and revision.*fresh Framescaper-local store.*next revision.*higher fencing token.*shared media catalog.*empty/isu,
	);
	for (const path of [
		'desktop/project-library-editor-media-service.ts',
		'desktop/project-library-media-binding.ts',
		'desktop/project-library-media-inventory-reclamation.ts',
		'desktop/project-library-media-inventory-schema.ts',
		'desktop/project-library-media-inventory-store.ts',
		'desktop/project-library-media-inventory.ts',
		'desktop/project-library-media-reclamation.ts',
		'desktop/project-library-media-reuse.ts',
		'desktop/project-library-media.ts',
		'desktop/project-library-host.ts',
		'desktop/project-library-projects.ts',
		'desktop/project-library-ipc.js',
		'desktop/preload.mjs',
		'desktop/main.mjs',
		'scripts/lib/desktop-project-library-runtime.mjs',
		'src/common/editor/controller/project-admin-service.ts',
		'src/common/editor/storage/desktop-shared-project-media-contract.ts',
		'src/common/editor/storage/desktop-shared-project-media-sources.ts',
		'src/common/editor/storage/desktop-shared-project-media-sender.ts',
		'src/common/editor/storage/desktop-shared-project-media-acquisition.ts',
		'src/common/editor/storage/desktop-shared-project-media-transfer.ts',
		'src/common/editor/storage/desktop-shared-project-repository.ts',
		'src/common/editor/storage/media-content-digest.ts',
		'src/common/editor/storage/media-asset-write-contract.ts',
		'src/common/editor/storage/media-asset-owned-publication.ts',
		'src/common/editor/storage/media-asset-write-repository.ts',
		'src/common/editor/storage/source-record-repository.ts',
		'src/common/editor/storage/source-repository.ts',
		'src/common/editor/storage/source-write-repository.ts',
		'src/common/editor/storage.js',
		'tests/audio-editor-project-admin-service.test.ts', 'tests/audio-editor-project-admin-service-coverage.test.ts',
		'tests/desktop-project-library-host.test.ts',
		'tests/desktop-project-library-ipc.test.js',
		'tests/desktop-project-library-editor-media-service.test.ts',
		'tests/desktop-project-library-editor-media-lifecycle.test.ts',
		'tests/desktop-project-library-editor-media-freshness.test.ts',
		'tests/desktop-project-library-media.test.ts',
		'tests/desktop-project-library-video-media.test.ts',
		'tests/desktop-project-library-editor-video-media-service.test.ts',
		'tests/desktop-project-library-media-inventory-store.test.ts',
		'tests/desktop-project-library-media-inventory.test.ts',
		'tests/desktop-project-library-media-reclamation.test.ts',
		'tests/desktop-project-library-media-reuse.test.ts',
		'tests/desktop-project-library-editor-media-reuse-fallback.test.ts',
		'tests/desktop-project-library-packaging.test.js',
		'tests/audio-editor-desktop-shared-project-media-transfer.test.ts',
		'tests/audio-editor-desktop-shared-project-media-sender-video.test.ts',
		'tests/audio-editor-desktop-shared-project-mixed-media-acquisition.test.ts',
		'tests/audio-editor-desktop-shared-project-media-transfer-budget.test.ts',
		'tests/audio-editor-desktop-shared-project-media-transfer-ownership.test.ts',
		'tests/audio-editor-media-asset-ownership.test.ts',
		'tests/audio-editor-desktop-shared-project-repository-handoff.test.ts',
		'tests/audio-editor-source-record-ownership.test.ts',
		'tests/audio-editor-source-write-cancellation.test.ts',
		'tests/desktop-project-library-managed-audio-handoff.test.ts',
		'tests/desktop-project-library-audio-rendered-fallback-handoff.test.ts',
		'tests/desktop-project-library-video-rendered-fallback-handoff.test.ts', 'tests/audio-editor-desktop-shared-project-video-clip-fallback-handoff.test.ts',
		'tests/desktop-project-library-mixed-media-roundtrip.test.ts',
	]) assert.ok(managedHandoffControl.evidence.some((item) => item.path === path), path);
	assert.match(
		managedHandoffControl.summary,
		/explicit handoff.*ordinary project saves remain document-only.*writable sender.*flushes first.*feature-requirement-only intrinsic read-only.*unchanged active snapshot.*without flushing.*current writable project lock.*declared read-only.*future-schema.*lock-contended.*reject.*before any source body read or bridge call.*4,094 reachable logical sources.*same-kind physical bindings.*rejects conflicts.*aggregate 64 GiB audio-and-video byte budget.*audio-only 65,536-chunk budget.*two full validating reads.*canonical-PCM or retained-original-video.*binding is absent.*second read.*4-MiB chunks.*pathless IPC/isu,
	);
	assert.match(
		managedHandoffControl.summary,
		/four active uploads.*four active reads.*across the bridge service.*renderer owner.*source kind, identity, geometry.*audio-f32le-chunks-v1.*video-original-v1.*exact current project revision.*derives the catalog document SHA-256 rather than accepting it from the renderer.*revision-and-document-digest validation.*immutable binding identity.*exact revision.*exact document digest.*storage-key\/media geometry.*prior-revision media.*same-revision document variants.*neither advertised nor accepted as present.*exact-present reuse.*byte length.*SHA-256.*reverifies/isu,
	);
	assert.match(
		managedHandoffControl.summary,
		/same-kind canonical binding.*fully verify a donor.*private random staged hard link.*promote it exclusively.*opaque or corrupt donors.*skipped.*exhausted donor.*another.*target races never overwrite.*unsupported hard-link failures.*bounded upload.*operational failures propagate.*catalog-publication retry.*uploaded or linked materialized target.*reverifies.*without consuming.*offered stream/isu,
	);
	assert.match(
		managedHandoffControl.summary,
		/after point-in-time capacity admission.*before directory or stage creation, hard-link work, or body consumption.*exact canonical row.*random upload or reuse stage.*schema-3 authoritative inventory.*descriptor provenance.*live lease and fencing token.*registered regular stage.*directory-syncs.*canonical row materialized.*removes the stage row.*catalog preparation.*exact materialized or published row.*catalog commit.*published atomically with metadata/isu,
	);
	assert.match(
		managedHandoffControl.summary,
		/after metadata-journal recovery.*project-file reclamation.*startup logically retires.*tracked descriptors.*exact project ID, revision, and document digest.*preserves unmanaged or opaque.*settles retirement.*normal journal.*before physical work.*current recognized descriptor.*exact materialized or published inventory.*fails startup before managed-media filesystem mutation.*physical cleanup alternates persisted stage and canonical high-water cycles.*100,000-total-row startup cap.*64-row lease-fenced transactions.*exact tracked regular stages and canonical bodies.*deterministic quarantine.*protects current catalog rows.*restarts the canonical cursor.*non-regular, symlinked, unregistered, legacy, and foreign paths untouched.*startup failure releases the lease/isu,
	);
	assert.match(
		managedHandoffControl.summary,
		/fresh-recipient acquisition.*exact bounded reads.*staged audio-source or video-media writers.*descriptor identity.*kind and storage key.*byte length.*SHA-256.*canonical audio byte geometry.*atomic if-absent.*opaque retained video.*not decoded or probed for media geometry.*losing absence race.*only its staging.*pre-shadow rollback.*acquisition-owned audio records or owned video publications.*source-token, path, or media-chunk payloads.*preserving a concurrent replacement.*durable exact shadow.*both kinds.*late cancellation/isu,
	);
	assert.match(
		managedHandoffControl.summary,
		/headless Soundscaper-to-Framescaper edit\/save\/return fixture.*fresh acquisition.*exact PCM engine input.*exact Blob video bytes.*play\/stop state.*distinct revision-bound rows.*one inode per exact body.*tested Linux filesystem.*product-local histories.*no bridge or shared-library body read or upload.*original profile.*does not qualify packaged Electron UI.*source-bearing executable workflows.*browser video-codec playback/isu,
	);
	assert.match(
		managedHandoffControl.summary,
		/narrower fixture.*manifest-only exact-schema role-defined unknown-feature audio fallback PCM.*feature-requirement-only read-only sender.*current writable lock.*without flush.*empty recipient.*original and exact shadow.*controller independently verifies the manifest digest.*exact fallback samples/isu,
	);
	assert.match(
		managedHandoffControl.summary,
		/older one-way whole-project fixture.*Framescaper.*editable retained-video original.*manifest-only first-party video-effects fallback.*empty Soundscaper recipient.*both exact video bodies.*exact shadow.*controller independently verifies the manifest digest.*exact fallback Blob URL.*distinct clip-target fixture.*target canonical video.*unaffected video.*manifest-only first-party video-effects fallback.*fresh recipient.*commits and reopens.*exact shadow.*relationship unchanged.*rejects wrong-target and whole-project relationship admission.*admits the exact target relationship.*playback and delivery.*replace only the target.*preserving the unaffected video.*transfer verifies only each managed descriptor and body digest/isu,
	);
	assert.deepEqual(managedMediaCapacityControl.evidence, [
		{ kind: 'implementation', path: 'desktop/project-library-contract.ts' },
		{ kind: 'implementation', path: 'desktop/project-library-media-capacity.ts' },
		{ kind: 'implementation', path: 'desktop/project-library-media.ts' },
		{ kind: 'implementation', path: 'scripts/lib/desktop-project-library-runtime.mjs' },
		{ kind: 'test', path: 'tests/desktop-project-library-media-capacity.test.ts' },
		{ kind: 'test', path: 'tests/desktop-project-library-packaging.test.js' },
		{ kind: 'test', path: 'tests/production-security-shared-project-library.test.js' },
	]);
	assert.match(
		managedMediaCapacityControl.summary,
		/one DesktopLibraryManagedMediaStore instance.*exact-absent audio or video binding.*prospective catalog.*same-instance pending descriptors.*50,000-row.*4 MiB serialized-metadata ceilings.*lower-only test seams.*synchronously reserves one row.*declared body bytes.*aggregate 64 GiB pending-byte ceiling.*before awaiting.*BigInt statfs.*managed-media root/isu,
	);
	assert.match(
		managedMediaCapacityControl.summary,
		/failed, malformed, or known-insufficient.*reject before managed-media directory work.*body iteration.*optional hard-link work.*reservation remains held through descriptor-publication settlement.*final publication rereads the catalog.*revalidates.*lower-only and hard catalog ceilings.*exact-present binding.*bypasses.*capacity admission.*descriptor and body verification/isu,
	);
	assert.match(
		managedMediaCapacityControl.summary,
		/store-instance, point-in-time admission.*not an operating-system.*cross-instance or cross-process.*whole-handoff.*renderer-session reservation.*beginSourceWrite.*return ready before asynchronous host\/store refusal.*appData project-document.*SQLite\/WAL allocation.*filesystem allocation overhead.*later external allocation.*write-time success.*UI state.*continuous runtime cleanup beyond the bounded startup tracked inventory.*empty-directory cleanup.*SQLite\/WAL space reclamation remain unqualified.*hard-link reuse.*full declared body.*reject a feasible link/isu,
	);
	for (const [kind, path] of [
		['implementation', 'desktop/desktop-smoke.js'],
		['implementation', 'scripts/lib/desktop-project-library-handoff-smoke.mjs'],
		['implementation', 'scripts/desktop-project-library-handoff-smoke.mjs'],
		['test', 'tests/desktop-smoke-probe.test.js'],
		['test', 'tests/desktop-project-library-handoff-smoke.test.js'],
		['test', 'tests/desktop-project-library-handoff-workflow.test.js'],
		['workflow', '.github/workflows/desktop-preview.yml'],
	]) assert.ok(
		packagedSourceFreeControl.evidence.some((item) => item.kind === kind && item.path === path),
		`${kind}:${path}`,
	);
	assert.match(
		packagedSourceFreeControl.summary,
		/dedicated Linux x64 CI.*two separate unpacked.*Soundscaper.*Framescaper.*sequential Soundscaper.*Framescaper.*Soundscaper.*only.*isolated appData.*separate product profiles.*reuses.*Soundscaper profile.*renderer.*ready.*pathless preload IPC.*exact[- ]SHA-256.*source-free.*schema 9.*revisions 1, 2, and 3.*summary.*main-only catalog row.*clean recovery.*no stale takeover.*higher fencing tokens.*increasing catalog revisions.*preferred product.*awaits process exit.*lease release/isu,
	);
	assert.match(
		packagedSourceFreeControl.summary,
		/combined with.*composed editor.*closes only the generic packaged source-free preload\/IPC\/multi-process\/executable lifecycle gap.*does not qualify packaged controller autosave or tab activation.*source-bearing bytes, playback, or managed media.*concurrent opens.*crash or stale takeover.*interruption or power loss.*path identity.*installers or file associations.*Windows, macOS, or ARM64.*third-party.*gating.*legacy Soundscaper.*migration/isu,
	);
	for (const path of [
		'src/common/editor/controller/project-bootstrap-service.ts',
		'src/common/editor/retention.js',
		'src/common/editor/scape-abort.ts',
		'src/common/editor/scape-archive-envelope.ts',
		'src/common/editor/scape-archive-media.ts',
		'src/common/editor/scape-expanded-byte-budget.ts',
		'src/common/editor/storage/desktop-shared-project-media-contract.ts',
		'src/common/editor/storage/desktop-shared-project-media-sources.ts',
		'src/common/editor/storage/desktop-shared-project-media-acquisition.ts',
		'src/common/editor/storage/desktop-shared-project-media-transfer.ts',
		'src/common/editor/storage/desktop-shared-project-repository.ts',
		'src/common/editor/storage/desktop-shared-project-source-availability.ts',
		'src/common/editor/storage/media-asset-digest-backfill.ts',
		'src/common/editor/storage/media-content-digest.ts',
		'src/common/editor/storage/media-asset-write-contract.ts',
		'src/common/editor/storage/media-asset-owned-publication.ts',
		'src/common/editor/storage/media-asset-write-repository.ts',
		'src/common/editor/storage/project-repository.ts',
		'src/common/editor/storage/retention-repository.ts',
		'src/common/editor/storage/source-read-repository.ts',
		'src/common/editor/storage/source-record-repository.ts',
		'src/common/editor/storage/source-repository.ts',
		'src/common/editor/storage/source-write-repository.ts',
		'src/common/editor/storage.js',
		'src/common/editor/app.js',
		'tests/audio-editor-desktop-shared-project-mutation-serialization.test.ts',
		'tests/audio-editor-desktop-shared-project-repository.test.ts',
		'tests/audio-editor-desktop-shared-project-source-availability-integration.test.ts',
		'tests/audio-editor-desktop-shared-project-source-availability.test.ts',
		'tests/audio-editor-desktop-shared-project-media-transfer.test.ts',
		'tests/audio-editor-desktop-shared-project-mixed-media-acquisition.test.ts',
		'tests/audio-editor-desktop-shared-project-media-transfer-budget.test.ts',
		'tests/audio-editor-desktop-shared-project-media-transfer-ownership.test.ts',
		'tests/audio-editor-media-asset-ownership.test.ts',
		'tests/audio-editor-desktop-shared-project-repository-handoff.test.ts',
		'tests/audio-editor-source-record-ownership.test.ts',
		'tests/audio-editor-source-write-cancellation.test.ts',
		'tests/audio-editor-project-bootstrap-service.test.ts',
		'tests/desktop-project-library-editor-handoff.test.ts',
		'tests/desktop-project-library-managed-audio-handoff.test.ts',
		'tests/desktop-project-library-audio-rendered-fallback-handoff.test.ts',
		'tests/desktop-project-library-video-rendered-fallback-handoff.test.ts', 'tests/audio-editor-desktop-shared-project-video-clip-fallback-handoff.test.ts',
		'tests/desktop-project-library-mixed-media-roundtrip.test.ts',
		'tests/production-security-shared-project-library.test.js',
	]) assert.ok(mediaAdmissionControl.evidence.some((item) => item.path === path), path);
	assert.match(
		mediaAdmissionControl.summary,
		/latest authoritative exact-schema-9 shared load.*4,094 reachable timeline, Project Bin, and fallback sources.*before source bodies are read.*deduplicates compatible same-kind physical bindings.*rejects conflicts.*aggregate 64 GiB audio-and-video byte budget.*audio-only 65,536-chunk budget.*fresh recipient.*managed canonical-PCM and retained-original-video descriptors.*4 MiB reads.*staged local audio-source or media-asset writers.*descriptor identity.*kind and storage key.*byte length.*SHA-256.*canonical audio byte geometry.*atomic if-absent.*opaque retained video.*not decoded or probed for media geometry/iu,
	);
	assert.match(
		mediaAdmissionControl.summary,
		/loses the absence race.*only its staging.*pre-shadow failure.*exact acquisition-owned audio records or owned video publications.*source-token, path, or media-chunk payloads.*preserving concurrent replacements.*unacquired sources.*pre-existing recipient-local exact-schema-9 binding.*compatible same-kind aliases.*verified once.*audio.*ordered Float32Array geometry.*video.*trusted local digest.*SHA-256.*4 MiB windows.*migration and digest backfill disabled.*pre-shadow failures preserve the prior local shadow.*prevent activation.*after the exact shadow is durable.*retains.*acquired audio and video.*source-free loads.*no media I\/O/iu,
	);
	assert.match(
		mediaAdmissionControl.summary,
		/headless composed fixture.*exact managed mixed-media acquisition.*playback-controller access.*edit\/save\/return.*original-profile reopen.*without bridge or shared-library body transfer.*neither an atomic unmanaged-media snapshot or publisher authentication.*stable byte lease through real playback.*packaged Electron UI.*browser video-codec behavior/iu,
	);
	assert.match(
		mediaAdmissionControl.summary,
		/separate fresh-recipient fixtures.*manifest-only role-defined unknown-feature audio fallback PCM.*whole-project first-party video-effects fallback.*editable retained-video original.*distinct clip-target fallback.*target canonical video.*unaffected video.*whole-project fixture.*controller-owned manifest-digest verification.*transient playback activation.*clip-target recipient.*commits and reopens.*exact shadow.*relationship unchanged.*rejects wrong-target and whole-project relationship admission.*admits the exact relationship.*playback and delivery.*replace only the target.*preserve the unaffected video.*managed acquisition itself verifies each transfer descriptor and body digest/isu,
	);
	for (const path of [
		'desktop/linked-video-locator-ipc.js',
		'desktop/read-capability-admission.js',
		'desktop/read-capability-range-stream.js',
		'src/common/editor/controller/project-visual-service.ts',
		'src/common/editor/storage/desktop-linked-video-range-reader.ts',
		'src/common/editor/storage/desktop-shared-project-linked-video-originals.ts',
		'src/common/editor/storage/linked-video-original-lifecycle-coordinator.ts', 'src/common/editor/storage/linked-video-original-resolver.ts', 'src/common/editor/storage/retention-repository.ts',
		'src/common/editor/ui/workspace/VideoPreviewPanel.jsx',
		'tests/desktop-linked-video-playback-capability.test.js',
		'tests/desktop-linked-video-playback-locator.test.ts',
		'tests/audio-editor-desktop-linked-video-playback-port.test.ts',
		'tests/audio-editor-linked-video-playback-resolver.test.ts',
		'tests/audio-editor-linked-video-locator-lifecycle.test.ts', 'tests/audio-editor-linked-video-original-cleanup.test.ts', 'tests/audio-editor-source-lifecycle-service.test.ts', 'tests/audio-editor-project-visual-service.test.ts',
		'tests/production-security-shared-project-library.test.js',
	]) assert.ok(linkedVideoControl.evidence.some((item) => item.path === path), path);
	assert.match(
		linkedVideoControl?.summary ?? '',
		/schema-1 closed product-local bindings.*exact project and source.*pathless opaque locator ID.*opaque locator-revision fence.*independent repository-owned CAS binding token.*storage key.*video MIME.*exact source geometry.*byte length.*lowercase SHA-256.*no filesystem path, URL, handle, or linked body.*project ID, source ID, storage key, MIME type, and every source-geometry field.*before privileged platform I\/O.*expected locator revision.*exact byte length.*complete SHA-256.*4 MiB windows.*rereads the binding.*CAS fence/isu,
	);
	assert.match(
		linkedVideoControl?.summary ?? '',
		/fresh per-operation alias session.*module-private WeakMap.*structurally forged proof.*rejected.*inspects every complete reachable video alias group before any linked body read.*conflicting geometry.*incomplete alias.*different locator or content identity.*not trusted.*metadata.*aggregate budget preflight.*before lazy first body resolution.*authentic session.*every exact project\/source binding and geometry.*metadata MIME, length, and digest.*storageKey alone never authorizes.*sibling binding replacement.*invalidates/isu,
	);
	assert.match(
		linkedVideoControl?.summary ?? '',
		/binding and descriptor-free shared admission.*no durable product-owned media row or body copy.*explicit managed handoff.*whole Blob.*maintained managed sender.*visual activation.*owner-scoped `linked-video-range-v1` playback lease.*exact locator revision.*exact byte length, MIME, and complete SHA-256.*at-most-4-MiB ranges.*pinned handle.*binding and CAS fence.*only a media URL and one-shot release.*does not construct another original-video Blob.*visual service owns.*lease.*Object URLs.*candidate and stored leases once.*bulk cleanup.*exact media URL.*ranged admission failure.*does not silently retry.*platform port without the optional playback lease/isu,
	);
	assert.match(
		linkedVideoControl?.summary ?? '',
		/bounded same-store\/process lifecycle coordinator.*serializes binding mutations.*project deletion and whole-store clear.*100,000 binding rows.*128 unique exact locator\/revision pairs.*deduplicates aliases.*local project-and-binding commit.*before exact locator metadata release.*re-inventories.*live locator-ID alias.*prevents release.*release rejection.*committed cleanup error.*bounded pending retry.*rechecks aliases.*fulfilled false.*stale.*settles.*external target untouched.*source-level reachability outside maintained saves and successful writable activations.*surviving project.*open.*separate store or process.*not serialized.*crash.*not qualified.*packaged executable\/UI and operating-system behavior.*not qualified.*pathname movement, deletion, or replacement after playback admission cannot retarget.*same-inode external mutation.*not fenced.*not an immutable, durable, or cross-process byte snapshot.*binding, whole-Blob resolution, availability, and handoff.*complete body.*512 MiB.*digest slices and playback responses.*not whole-Blob provider allocation.*decoder or codec amplification.*RSS.*reference-scale evidence.*relink or watch UI.*linked audio.*absent/isu,
	);
	for (const path of [
		'desktop/linked-video-locator-store.ts', 'desktop/linked-video-locator-ipc.js', 'desktop/preload.mjs',
		'desktop/read-capability-range-stream.js',
		'src/common/editor/controller/project-bootstrap-service.ts',
		'src/common/editor/controller/project-visual-service.ts',
		'src/common/editor/storage/desktop-linked-video-range-reader.ts',
		'src/common/editor/storage/linked-video-original-lifecycle-coordinator.ts', 'src/common/editor/storage/linked-video-original-repository.ts', 'src/common/editor/storage/retention-repository.ts',
		'src/common/editor/storage/linked-video-original-resolver.ts',
		'tests/desktop-linked-video-locator-store.test.ts', 'tests/desktop-linked-video-locator-ipc.test.js',
		'tests/desktop-preload-linked-video-original.test.js', 'tests/desktop-linked-video-locator-reconciliation.test.ts',
		'tests/desktop-linked-video-playback-capability.test.js',
		'tests/desktop-linked-video-playback-locator.test.ts',
		'tests/audio-editor-desktop-linked-video-playback-port.test.ts',
		'tests/audio-editor-linked-video-playback-resolver.test.ts',
		'tests/audio-editor-project-bootstrap-service.test.ts', 'tests/audio-editor-linked-video-original-repository.test.ts',
		'tests/audio-editor-linked-video-locator-lifecycle.test.ts', 'tests/audio-editor-linked-video-original-cleanup.test.ts', 'tests/audio-editor-linked-video-original-resolver.test.ts', 'tests/audio-editor-source-lifecycle-service.test.ts',
	]) assert.ok(linkedVideoChooserControl.evidence.some((item) => item.path === path), path);
	assert.match(
		linkedVideoChooserControl.summary,
		/ordinary locator load.*`materialized-v1`.*playback load.*exact locator revision.*current pathname identity.*`linked-video-range-v1`.*opened handle.*replacement after playback admission cannot retarget.*selection and import adapter.*whole-Blob tier.*closed exact locator ID-and-revision CAS release.*missing, malformed, or accessor revision.*never authorizes cleanup.*visual activation.*exact-revision ranged playback lease.*full SHA-256 sequentially.*at-most-4-MiB responses.*binding and its CAS fence.*only the returned media URL and one-shot release.*does not construct another original-video Blob.*candidate and stored leases once.*failed ranged admission.*does not silently fall back.*same-inode external mutation.*not fenced.*not an immutable, durable, or cross-process byte snapshot.*selection, binding, whole-Blob resolution, availability, and handoff.*complete body.*reference-scale evidence/isu,
	);
	assert.match(
		linkedVideoChooserControl.summary,
		/exact release.*serialized revision CAS.*missing, stale, or pre-revoked.*false without a registry write.*failed first persistence.*restores only in-memory state.*on-disk outcome.*indeterminate.*bounded same-store\/process lifecycle coordinator.*100,000 binding rows.*128 unique exact locator\/revision pairs.*aliases.*local commit.*before metadata release.*reported committed cleanup error.*pending retry.*fresh alias inventory.*fulfilled false.*settles.*durable IndexedDB opens.*before project loading.*maintained renderer.*point-in-time authoritative catalog.*10,000 exact canonical project IDs.*exact linked-binding identity contract.*before opening the binding transaction.*invalid or duplicate project IDs.*reject bootstrap.*Memory fallback returns before catalog listing, binding mutation, or IPC.*durable platform port without reconciliation.*catalog.*no binding mutation or IPC.*one IndexedDB readwrite binding-store transaction.*100,000 closed rows.*128 unique exact locator\/revision pairs.*live and absent-project bindings.*malformed rows.*conflicting revisions.*exceeded limits.*delete failure.*abort and roll back.*before IPC.*complete scan.*delete bindings whose project ID is absent.*locator remains live.*alias.*catalog project.*frozen sorted positive inventory.*existing closed preload\/IPC.*project-ID membership.*does not inspect source-level reachability.*surviving project.*catalog snapshot.*binding transaction.*main registry write.*not one cross-boundary atomic operation.*binding deletion commits before.*separate main registry operation.*later main rejection.*retry.*serialized pass.*only startup-loaded metadata.*runtime-created records.*failed attempts.*retryable.*at most one successful pass.*per store\/process.*unknown or stale references.*before mutation.*failed first registry write.*restores the in-memory inventory.*owner revocation after a deletion write.*second persisted restore.*indeterminate on-disk outcome.*never stats or deletes external files.*next successful full bootstrap.*startup-loaded chooser metadata.*no durable live binding.*binding rows.*durably removed.*current-process abandoned records.*later main-process restart.*cannot authenticate inventory completeness.*compromised renderer.*omit live references.*retire startup locator metadata.*separate store, profile, or process.*not serialized.*cooperative first-party lifecycle housekeeping.*not a renderer-compromise integrity control.*orderly close, dispose, and reopen.*abrupt process death.*power loss.*unqualified.*source-level cleanup outside maintained saves and successful writable activations.*general continuous runtime cleanup beyond same-store save\/activation\/delete\/clear.*hostile IndexedDB row.*absent/isu,
	);
	assert.match(
		reclamationControl.summary,
		/recovery.*before the host is exposed.*authoritative project-file inventory.*monotonic row IDs.*captur(?:es|ed).*high-water.*persist(?:s|ed).*cursor.*100,000 rows.*64-row.*SQLite immediate writer transaction.*exact live lease.*before and after filesystem work.*portable case-folded reachability.*current catalog.*previous and next.*pending prepared or committed journal.*deterministic noncatalogable quarantine.*unregistered.*stage.*canonical.*forged quarantine.*foreign.*do not consume.*budget.*untouched.*100,001-row.*successive bounded passes.*later inserts.*next high-water cycle.*yield.*renewal and cancellation.*root symlinks fail closed.*managed media.*untouched.*reclamation-failure lease release.*without adding IPC/isu,
	);
	assert.match(
		stageReclamationControl.summary,
		/registers.*unique random canonical stage path.*planned project row.*one immediate SQLite transaction.*exact lease.*fencing token.*before exclusive open.*exact-lease cleanup.*acknowledged.*exclusive-open failure.*registration.*without unlinking.*error after exclusive creation.*registered random stage.*lost-lease or failed cleanup.*registration.*takeover.*materialization.*exact metadata path.*stage path.*lease ID.*fencing token.*renames the file.*syncs its containing directory.*marks the project materialized.*removes the stage row.*before-and-after fenced transaction.*separate monotonic stage inventory.*persisted high-water.*cursor.*persisted project\/stage schedule.*64-row batches.*shared 100,000-row invocation cap.*current exact-lease.*remain live.*prior-lease regular files.*removed.*missing rows retire.*non-regular targets.*non-direct parents.*untouched and inventoried.*canonical rows with outstanding stages.*ineligible.*rescan flag.*restarting the canonical high-water.*unregistered and legacy pre-inventory stage-looking files.*foreign.*do not consume.*budget.*untouched.*without adding renderer IPC/isu,
	);
	assert.deepEqual(
		risk.residualRisks.map(({ id }) => id).sort(),
		[
			'shared-library-cross-product-media-availability',
			'shared-library-packaged-platform-durability',
		],
	);
	assert.equal(
		risk.residualRisks.some(({ id }) => id === 'shared-library-privileged-domain-validation'),
		false,
	);
	assert.equal(
		risk.residualRisks.some(({ id }) => id === 'shared-library-orphan-reclamation'),
		false,
	);
	const platformDurability = risk.residualRisks.find(
		({ id }) => id === 'shared-library-packaged-platform-durability',
	);
	assert.match(
		platformDurability?.exposure ?? '',
		/dedicated Linux x64.*source-free.*packaged preload\/IPC\/multi-process\/executable lifecycle.*qualified.*remaining OS and architecture matrix.*parent- or database-path replacement.*power-loss durability.*Windows directory-sync and deny-delete behavior.*junction.*time-of-check\/time-of-use.*interrupted reservation.*foreign regular collision.*registered random stage path.*eligible.*stale-stage cleanup.*registered non-regular or symlink stage replacements.*untouched and inventoried/isu,
	);
	assert.match(
		platformDurability?.acceptanceCriteria.join(' ') ?? '',
		/publication and reclamation phase.*database and project-root identity.*Windows sharing behavior.*junction handling/isu,
	);
	const managedMedia = risk.residualRisks.find(
		({ id }) => id === 'shared-library-cross-product-media-availability',
	);
	assert.match(
		managedMedia?.exposure ?? '',
		/explicit managed handoff.*revision-and-document-digest-bound.*digest-verified canonical PCM plus retained original video publication.*fresh-recipient if-absent acquisition.*headless Soundscaper-to-Framescaper edit\/save\/return workflow.*same-kind content.*distinct revision-bound rows.*verified optional hard-link path.*unsupported-link failures.*bounded upload.*exact-schema role-defined unknown-feature audio whole-mix fallback.*manifest.*only reference.*feature-requirement-only read-only sender.*current writable lock.*without flush.*fresh recipient.*manifest-digest verified by the controller.*transfer verifies its own descriptor and body digest.*corrupts recipient-local fallback PCM after activation.*final delivery refusal before render or download.*restoring exact PCM.*expected fallback samples.*WAV output.*canonical project state remains unchanged.*older exact-schema whole-project first-party video-effects fallback.*manifest-only.*editable retained-video original.*Framescaper.*fresh Soundscaper recipient.*exact shadow.*manifest-digest verified.*exact Blob URL.*distinct clip-target videoEffects witness.*target canonical video.*unaffected video.*fallback.*fresh recipient.*commits and reopens.*exact shadow.*relationship unchanged.*rejects wrong-target and whole-project relationship admission.*admits the exact relationship.*playback and delivery.*replace only the target.*preserve the unaffected video.*transfer verifies each descriptor and body digest.*managed handoff fixtures.*headless point-in-time whole-Blob workflows.*packaged codec or durable playback qualification/isu,
	);
	assert.match(
		managedMedia?.exposure ?? '',
		/exact-absent managed-media binding.*same-store point-in-time prospective catalog and destination-capacity admission.*before body or optional hard-link work.*exact-present retries.*body reverification.*beginSourceWrite.*report ready before asynchronous host\/store capacity refusal.*not an operating-system.*cross-instance or cross-process.*whole-handoff.*SQLite\/WAL or allocation-overhead.*UI.*later-external-allocation.*write-time guarantee.*full-body charging.*refuse.*feasible hard link.*authoritative managed canonical and stage inventories.*bind publication.*startup-only logical retirement.*orphan recovery.*physical reclamation.*tracked rows.*100,000.*later startup.*continuous runtime cleanup.*empty-directory.*SQLite\/WAL space reclamation.*external-writer mutation.*unregistered, legacy, or foreign content remain absent/isu,
	);
	assert.match(
		managedMedia?.exposure ?? '',
		/unmanaged recipient admission.*sequential point-in-time check.*metadata.*not transactionally bound.*same-metadata replacement.*undetected.*later replacement or deletion.*not fenced.*separate repository instances or processes.*not serialized.*non-cooperative work.*continue after rejection.*unmanaged audio.*lacks a publisher digest.*linked retained video.*product-local chooser.*validated main\/preload boundary.*whole-Blob selection and import adapter.*exact-binding import.*owner-scoped exact-revision ranged visual playback.*binding-scoped disposable previews.*raw paths.*private main-owned registry.*renderer and project state.*pathless.*point-in-time check.*not an operating-system bookmark.*pathname replacement after playback admission cannot retarget.*same-inode external mutation.*not fenced.*not an immutable, durable, or cross-process byte snapshot.*selection, binding, whole-Blob resolution, availability, and handoff.*complete body.*512 MiB.*visual activation.*at-most-4-MiB ranges.*only a media URL and one-shot release.*without constructing another original-video Blob.*failed ranged admission.*does not silently fall back.*decoder or codec amplification.*RSS.*reference-scale evidence.*successful maintained bootstrap.*durable IndexedDB opens.*before project loading.*point-in-time authoritative catalog.*10,000 exact canonical project IDs.*exact linked-binding identity contract.*before opening the binding transaction.*invalid or duplicate project ID.*rejects bootstrap.*Memory fallback returns before catalog listing, binding mutation, or IPC.*durable platform port without reconciliation.*catalog.*no binding mutation or IPC.*one IndexedDB readwrite binding-store transaction.*100,000 closed rows.*128 unique exact locator\/revision pairs.*live and absent-project bindings.*Malformed rows.*conflicting revisions.*exceeded limits.*delete failure.*abort and roll back.*before IPC.*complete scan.*delete bindings whose project ID is absent.*live alias.*catalog project.*preserves the locator.*frozen sorted positive inventory.*existing closed preload\/IPC.*Project-ID membership.*does not inspect source-level reachability.*surviving project.*catalog snapshot.*binding transaction.*main registry write.*not one cross-boundary atomic operation.*binding deletion.*commit.*later main rejection.*retry.*at most one successful serialized pass.*store\/process.*only startup-loaded locator metadata.*runtime-created records.*never touching external files.*Unknown or stale submitted references.*before mutation.*failed first registry write.*restores in-memory state.*owner revocation after deletion.*second persisted restore.*indeterminate on-disk outcome.*current-process abandoned locators.*later main-process restart.*cannot authenticate inventory completeness.*compromised renderer.*omit live references.*retire startup metadata.*separate store, profile, or process.*not serialized.*cooperative lifecycle housekeeping.*rather than a renderer-compromise integrity control.*orderly close, dispose, and reopen.*not abrupt process death.*power-loss qualification.*continuous runtime cleanup.*open.*linked audio.*authored proxies.*rendered-fallback authoring and managed acquisition or handoff beyond the closed audio and maintained first-party video roles.*packaged first-party video-effects fallback workflows.*relink.*watch behavior.*general consolidation.*not qualified in a packaged executable.*browser video-codec behavior.*packaged Electron UI two-product source-bearing lifecycle.*open.*cross-platform hard-link.*crash or power-loss.*unqualified/isu,
	);
	assert.doesNotMatch(
		managedMedia?.exposure ?? '',
		/digestless retained video.*not authenticated/iu,
	);
	assert.match(
		managedMedia?.requiredControl ?? '',
		/portable mixed-media handoff.*qualify the maintained least-authority linked-video chooser, import, and ranged playback plus linked-WAV ranged reads.*packaged executables.*supported platforms.*durable operating-system locator.*immutable or cross-process byte-identity semantics.*reference-scale or stable playback.*reconcile source-level linked-binding reachability during startup and beyond maintained same-store saves and successful writable activations.*continuous cleanup beyond the bounded startup pass.*replace renderer-asserted completeness.*independently authenticated liveness authority.*compromised-renderer availability integrity.*coordinate catalog, binding, and registry mutation.*cross-store or cross-process atomicity.*portable stable original and authored-proxy relationships.*remaining rendered-fallback relationships.*linked audio and otherwise unmanaged media.*relink.*watch.*general consolidation.*extend the bounded managed-media collector.*continuous runtime.*empty-directory.*database-space.*foreign-file cleanup.*capacity control.*exact allocation.*whole-handoff.*renderer-session.*cross-store.*cross-process.*safe write-time behavior.*hold or revalidate immutable byte identity through ranged reads and playback.*durable lease or equivalent same-inode mutation fence.*packaged Electron UI two-product source-bearing save and return lifecycle.*first-party video-effects fallback.*browser video-codec behavior.*supported-platform fallback.*optional body reuse/isu,
	);
	assert.match(
		managedMedia?.acceptanceCriteria.join(' ') ?? '',
		/packaged Soundscaper-to-Framescaper-to-Soundscaper source-bearing.*acquire every required mixed-media body.*managed, relink, copy, or consolidation.*stable byte identity through activation and playback.*save and return.*without accidental copies or lost history.*cleanup and capacity refusal.*missing-at-admission/isu,
	);
	const threatModel = await readFile(threatModelUrl, 'utf8');
	assert.match(
		threatModel,
		/Three narrower one-way headless fixtures.*audio fixture.*original and whole-mix PCM.*fresh Framescaper shadow.*controller manifest verification.*exact-sample activation.*whole-project\s+video fixture.*editable retained-video original.*full-render\s+fallback.*fresh Soundscaper shadow.*controller manifest verification.*exact fallback Blob URL.*separate clip-local video fixture.*canonical original.*digest-bound fallback.*fresh recipient.*exact target clip ID.*closes and reopens.*canonical shadow.*admits the relationship.*role.*target clip ID.*source ID.*SHA-256.*target-only playback.*Managed\s+acquisition verifies transfer descriptors and body digests.*does not\s+authenticate any manifest declaration.*no packaged UI.*browser-codec.*durable-lease.*whole-handoff\s+atomicity claim/isu,
	);
});

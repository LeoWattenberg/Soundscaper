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
		'desktop/project-library-ipc.js',
	]);
	for (const path of [
		'desktop/project-library-ipc.js',
		'tests/desktop-project-library-ipc.test.js',
	]) assert.ok(rendererBoundary.evidence.some((item) => item.path === path));
	assert.ok(preloadControl);
	assert.ok(revocationControl);
	for (const ipcControl of [preloadControl, revocationControl]) {
		for (const path of [
			'desktop/project-library-ipc.js',
			'tests/desktop-project-library-ipc.test.js',
		]) assert.ok(ipcControl.evidence.some((item) => item.path === path));
	}
	assert.match(
		preloadControl.summary,
		/shared-project methods.*bounded, pathless list, read, bundle, commit, delete, and managed-media transfer.*closed canonical-PCM and retained-original-video encodings.*independently sanitized in main.*four active managed-source uploads.*four active reads.*across the bridge service.*64 GiB.*4 MiB.*descriptors rather than filesystem paths.*owner-bound.*authorization and revocation/iu,
	);
	assert.match(
		revocationControl.summary,
		/owner revocation.*fences new operations.*aborts.*managed-source uploads.*drains admitted uploads and reads.*navigation.*renderer loss.*window close/iu,
	);
	assert.ok(revocationControl.evidence.some(
		({ path }) => path === 'tests/desktop-project-library-packaging.test.js',
	));
	assert.ok(libraryBoundary);
	assert.match(
		libraryBoundary.data,
		/maintained-domain-validated exact schemaVersion-9 project documents.*revision-and-document-digest-bound.*canonical-PCM and retained-original-video descriptors and bodies/iu,
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
		'desktop/project-library-media-reuse.ts',
		'tests/desktop-project-library-file-inventory.test.ts',
		'tests/desktop-project-library-reclamation.test.ts',
		'tests/desktop-project-library-reclamation-progress.test.ts',
		'tests/desktop-project-library-stage-reclamation.test.ts',
		'tests/desktop-project-library-media-capacity.test.ts',
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
		/fresh filesystem library scope v2.*ignores rather than migrates.*prior shared v1 scope.*schema 1 database.*v2 path.*rejected instead of implicitly migrated.*metadata schema 2.*separate opaque library entry ID.*exact schema 9.*bounded byte length.*SHA-256.*immutable revision-and-digest path.*canonical tagged-binary codec.*non-raiseable 256 MiB.*lower-only test seam.*persistence root identity.*reserves.*lease.*fencing-token.*authoritative project-file inventory.*before stage creation.*private file.*syncs it.*atomically renames it.*materialized.*every catalog reference.*before an exact plus-one catalog journal publication.*before staging.*before publication.*transactionally at catalog commit.*serializes commits.*renews its lease while close drains admitted work/isu,
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
		'desktop/project-library-media-reuse.ts',
		'desktop/project-library-media.ts',
		'desktop/project-library-host.ts',
		'desktop/project-library-projects.ts',
		'desktop/project-library-ipc.js',
		'desktop/preload.mjs',
		'desktop/main.mjs',
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
		'tests/audio-editor-project-admin-service.test.ts',
		'tests/desktop-project-library-host.test.ts',
		'tests/desktop-project-library-ipc.test.js',
		'tests/desktop-project-library-editor-media-service.test.ts',
		'tests/desktop-project-library-editor-media-lifecycle.test.ts',
		'tests/desktop-project-library-editor-media-freshness.test.ts',
		'tests/desktop-project-library-media.test.ts',
		'tests/desktop-project-library-video-media.test.ts',
		'tests/desktop-project-library-editor-video-media-service.test.ts',
		'tests/desktop-project-library-media-reuse.test.ts',
		'tests/desktop-project-library-editor-media-reuse-fallback.test.ts',
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
		'tests/desktop-project-library-mixed-media-roundtrip.test.ts',
	]) assert.ok(managedHandoffControl.evidence.some((item) => item.path === path), path);
	assert.match(
		managedHandoffControl.summary,
		/explicit post-flush handoff.*ordinary project saves remain document-only.*before any source body read or bridge call.*4,094 reachable logical sources.*same-kind physical bindings.*rejects conflicts.*aggregate 64 GiB audio-and-video byte budget.*audio-only 65,536-chunk budget.*two full validating reads.*canonical-PCM or retained-original-video.*binding is absent.*second read.*4-MiB chunks.*pathless IPC/isu,
	);
	assert.match(
		managedHandoffControl.summary,
		/four active uploads.*four active reads.*across the bridge service.*renderer owner.*source kind, identity, geometry.*audio-f32le-chunks-v1.*video-original-v1.*exact current project revision.*derives the catalog document SHA-256 rather than accepting it from the renderer.*revision-and-document-digest validation.*immutable binding identity.*exact revision.*exact document digest.*storage-key\/media geometry.*prior-revision media.*same-revision document variants.*neither advertised nor accepted as present.*exact-present reuse.*byte length.*SHA-256.*reverifies/isu,
	);
	assert.match(
		managedHandoffControl.summary,
		/same-kind canonical binding.*fully verify a donor.*private random staged hard link.*promote it exclusively.*opaque or corrupt donors.*skipped.*exhausted donor.*another.*target races never overwrite.*unsupported hard-link failures.*bounded upload.*operational failures propagate.*linked catalog-publication retry.*without another renderer upload.*normal-upload retry.*consumes and validates.*offered stream/isu,
	);
	assert.match(
		managedHandoffControl.summary,
		/fresh-recipient acquisition.*exact bounded reads.*staged audio-source or video-media writers.*descriptor identity.*kind and storage key.*byte length.*SHA-256.*canonical audio byte geometry.*atomic if-absent.*opaque retained video.*not decoded or probed for media geometry.*losing absence race.*only its staging.*pre-shadow rollback.*acquisition-owned audio records or owned video publications.*source-token, path, or media-chunk payloads.*preserving a concurrent replacement.*durable exact shadow.*both kinds.*late cancellation/isu,
	);
	assert.match(
		managedHandoffControl.summary,
		/headless Soundscaper-to-Framescaper edit\/save\/return fixture.*fresh acquisition.*exact PCM engine input.*exact Blob video bytes.*play\/stop state.*distinct revision-bound rows.*one inode per exact body.*tested Linux filesystem.*product-local histories.*no bridge or shared-library body read or upload.*original profile.*does not qualify packaged Electron UI or browser video-codec playback/isu,
	);
	assert.match(
		managedHandoffControl.summary,
		/narrower fixture.*manifest-only exact-schema first-party audio fallback PCM.*empty recipient.*original and exact shadow.*controller independently verifies the manifest digest.*exact fallback samples.*transfer verifies only the managed descriptor and body digest/isu,
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
		/store-instance, point-in-time admission.*not an operating-system.*cross-instance or cross-process.*whole-handoff.*renderer-session reservation.*beginSourceWrite.*return ready before asynchronous host\/store refusal.*appData project-document.*SQLite\/WAL allocation.*filesystem allocation overhead.*later external allocation.*write-time success.*UI state.*reclamation.*orphan recovery.*logical catalog-row retirement.*hard-link reuse.*full declared body.*reject a feasible link/isu,
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
		/separate fresh-recipient fixture.*first-party audio fallback PCM.*only by the manifest.*controller-owned manifest-digest verification.*transient playback activation.*managed acquisition itself verifies the transfer descriptor and body digest/isu,
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
		/explicit managed handoff.*revision-and-document-digest-bound.*digest-verified canonical PCM plus retained original video publication.*fresh-recipient if-absent acquisition.*headless Soundscaper-to-Framescaper edit\/save\/return workflow.*same-kind content.*distinct revision-bound rows.*verified optional hard-link path.*unsupported-link failures.*bounded upload.*exact-schema first-party audio whole-mix fallback.*manifest.*only reference.*fresh recipient.*manifest-digest verified by the controller.*transfer verifies its own descriptor and body digest/isu,
	);
	assert.match(
		managedMedia?.exposure ?? '',
		/exact-absent managed-media binding.*same-store point-in-time prospective catalog and destination-capacity admission.*before body or optional hard-link work.*exact-present retries.*body reverification.*beginSourceWrite.*report ready before asynchronous host\/store capacity refusal.*not an operating-system.*cross-instance or cross-process.*whole-handoff.*SQLite\/WAL or allocation-overhead.*UI.*later-external-allocation.*write-time guarantee.*full-body charging.*refuse.*feasible hard link.*reclamation.*orphan recovery.*logical catalog-row retirement.*absent/isu,
	);
	assert.match(
		managedMedia?.exposure ?? '',
		/unmanaged recipient admission.*sequential point-in-time check.*metadata.*not transactionally bound.*same-metadata replacement.*undetected.*later replacement or deletion.*not fenced.*separate repository instances or processes.*not serialized.*non-cooperative work.*continue after rejection.*unmanaged audio.*lacks a publisher digest.*linked or otherwise unmanaged originals.*authored proxies.*generic and video rendered fallbacks.*relink.*watch behavior.*copy or consolidation.*no stable lease through real playback.*browser video-codec behavior.*packaged Electron UI two-product source-bearing lifecycle.*open.*cross-platform hard-link.*crash or power-loss.*unqualified/isu,
	);
	assert.doesNotMatch(
		managedMedia?.exposure ?? '',
		/digestless retained video.*not authenticated/iu,
	);
	assert.match(
		managedMedia?.requiredControl ?? '',
		/portable mixed-media handoff.*stable original and authored-proxy relationships.*generic and video rendered-fallback relationships.*linked or otherwise unmanaged media.*relink.*watch.*copy or consolidation.*managed-media reclamation.*orphan recovery.*logical catalog-row retirement.*capacity control.*exact allocation.*whole-handoff.*renderer-session.*cross-store.*cross-process.*safe write-time behavior.*hold or revalidate byte identity through playback.*durable lease.*packaged Electron UI two-product source-bearing save and return lifecycle.*browser video-codec behavior.*supported-platform fallback.*optional body reuse/isu,
	);
	assert.match(
		managedMedia?.acceptanceCriteria.join(' ') ?? '',
		/packaged Soundscaper-to-Framescaper-to-Soundscaper source-bearing.*acquire every required mixed-media body.*managed, relink, copy, or consolidation.*stable byte identity through activation and playback.*save and return.*without accidental copies or lost history.*cleanup and capacity refusal.*missing-at-admission/isu,
	);
	const threatModel = await readFile(threatModelUrl, 'utf8');
	assert.match(
		threatModel,
		/rendered-fallback limitation.*narrowed.*maintained exception.*exact-schema first-party audio whole-mix PCM.*manifest is the only reference.*explicit\s+managed handoff.*editable original.*fresh recipient.*managed transfer.*descriptor and body digest.*controller separately.*project fallback declaration.*read-only transient\s+playback activation.*exact samples.*authored proxies.*generic and\s+video rendered-fallback relationships remain open.*unknown and\s+third-party activation/isu,
	);
});

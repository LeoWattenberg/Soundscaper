/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);

test('shared desktop project publication is fenced and remains narrowly partial', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const rendererBoundary = matrix.boundaries.find(({ id }) => id === 'renderer-to-electron-main');
	const libraryBoundary = matrix.boundaries.find(({ id }) => id === 'electron-main-to-shared-project-library');
	const ipcRisk = matrix.risks.find(({ id }) => id === 'electron-renderer-ipc-boundary');
	const risk = matrix.risks.find(({ id }) => id === 'shared-desktop-project-library-integrity');
	const control = risk?.currentControls.find(
		({ id }) => id === 'fenced-current-schema-project-catalog-publication',
	);
	const reclamationControl = risk?.currentControls.find(
		({ id }) => id === 'lease-fenced-immutable-project-reclamation',
	);
	const stageReclamationControl = risk?.currentControls.find(
		({ id }) => id === 'lease-fenced-registered-project-stage-reclamation',
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
	assert.match(preloadControl.summary, /shared-project methods.*bounded, pathless list, read, commit, and delete.*independently sanitized in main/iu);
	assert.match(revocationControl.summary, /owner revocation.*fences new operations.*drains operations admitted.*navigation.*renderer loss.*window close/iu);
	assert.ok(revocationControl.evidence.some(
		({ path }) => path === 'tests/desktop-project-library-packaging.test.js',
	));
	assert.ok(libraryBoundary);
	assert.match(libraryBoundary.data, /maintained-domain-validated exact schemaVersion-9 project documents/iu);
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
	]);
	for (const path of [
		'desktop/project-library-api.ts',
		'desktop/project-library-database.ts',
		'desktop/project-library-file-inventory.ts',
		'desktop/project-library-stage-inventory.ts',
		'desktop/project-library-reclamation.ts',
		'tests/desktop-project-library-file-inventory.test.ts',
		'tests/desktop-project-library-reclamation.test.ts',
		'tests/desktop-project-library-reclamation-progress.test.ts',
		'tests/desktop-project-library-stage-reclamation.test.ts',
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
	assert.ok(reclamationControl);
	assert.ok(stageReclamationControl);
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
		/identity service.*frozen preload.*owner-scoped IPC.*bounded pathless list, read, commit, and delete.*256 MiB.*4 KiB.*10,000-summary.*catalog summaries.*entry IDs.*main-owned catalog\/filesystem paths.*digests.*product preferences.*raw `?updatedAtMs`? fields.*leases.*fencing tokens.*revocation fences new work.*drains admitted operations/isu,
	);
	assert.match(
		control.summary,
		/renderer repository.*repeats maintained-persistence-domain exact-schema-9 validation and canonical reserialization.*before local mutation.*shared latest document and summary list.*authoritative.*product-local revision, source, and media shadow.*fails closed.*incomplete desktop bridge/isu,
	);
	assert.match(
		control.summary,
		/composed source-free editor fixture.*Soundscaper.*same identity and revision.*fresh Framescaper-local store.*next revision.*higher fencing token.*shared media catalog.*empty.*not a packaged preload, IPC, multi-process, or executable qualification/isu,
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
		/parent- or database-path replacement.*power-loss durability.*Windows directory-sync and deny-delete behavior.*junction.*time-of-check\/time-of-use.*interrupted reservation.*foreign regular collision.*registered random stage path.*eligible.*stale-stage cleanup.*registered non-regular or symlink stage replacements.*untouched and inventoried/isu,
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
		/source metadata.*shared document.*source and media bytes.*product-local shadows.*copy.*consolidation.*relink.*playback.*migration from the prior shared v1 scope or product-private Soundscaper libraries.*deliberately deferred and unsupported.*not a current required control/isu,
	);
	assert.match(
		managedMedia?.requiredControl ?? '',
		/source-bearing cross-product handoff.*recipient-side byte availability.*existing local bytes.*user-directed relink or copy.*managed storage.*fail closed before activation/isu,
	);
});

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const STATUS_VALUES = ['enforced', 'partial', 'planned', 'release-blocked'];
const DISPOSITION_VALUES = ['qualified-current-surface', 'conditional', 'surface-disabled', 'blocked'];
const EVIDENCE_KINDS = ['implementation', 'test', 'workflow', 'audit', 'document'];
const ROADMAP_THREAT_AREAS = [
	'malformed-projects-media',
	'archive-expansion',
	'native-helpers',
	'third-party-plugins',
	'path-capabilities',
	'job-cancellation',
];
const IMPLEMENTED_ARCHIVE_PREFLIGHT_CONTROLS = [
	'bounded-manifest-and-project-json',
	'central-directory-preflight',
	'cumulative-expanded-byte-limit',
	'descriptor-entry-size-match',
	'encrypted-entry-rejection',
	'inspect-import-validation-parity',
	'reserved-and-extra-entry-ownership',
];
const PENDING_ARCHIVE_EXPANSION_GATES = [];
const IMPLEMENTED_ARCHIVE_EXPANSION_CONTROLS = {
	'cumulative-actual-expanded-byte-limit': [
		'src/common/editor/scape-expanded-byte-budget.ts',
		'src/common/editor/scape-archive-envelope.ts',
		'src/common/editor/scape-archive-media.ts',
		'src/common/editor/scape-project.js',
		'tests/audio-editor-scape-expansion.test.ts',
	],
	'safe-pcm-frame-arithmetic': [
		'src/common/editor/scape-archive-media.ts',
		'src/common/editor/wavpack/pcm.js',
		'tests/audio-editor-scape-expansion.test.ts',
	],
	'zipjs-local-header-and-pairwise-overlap-preflight': [
		'src/common/editor/scape-archive-envelope.ts',
		'tests/audio-editor-scape-expansion.test.ts',
	],
	'local-header-and-overlap-validation': [
		'src/common/editor/scape-archive-layout.ts',
		'src/common/editor/scape-archive-reader.ts',
		'src/common/editor/scape-archive-zip-profile.ts',
		'src/common/editor/scape-export-estimate.ts',
		'tests/audio-editor-scape-archive-layout.test.ts',
		'tests/audio-editor-scape-export-estimate.test.ts',
		'tests/audio-editor-scape-expansion.test.ts',
	],
	'bounded-archive-operation-counts': [
		'src/common/editor/scape-archive-envelope.ts',
		'src/common/editor/scape-archive-media.ts',
		'src/common/editor/scape-project.js',
		'tests/audio-editor-scape-expansion.test.ts',
	],
	'compression-ratio-or-store-policy': [
		'src/common/editor/scape-archive-envelope.ts',
		'src/common/editor/scape-project.js',
		'tests/audio-editor-scape-archive-envelope.test.ts',
		'tests/audio-editor-scape-expansion.test.ts',
		'tests/audio-editor-scape-project.test.js',
	],
	'bounded-streaming-media-extraction': [
		'src/common/editor/scape-archive-video.ts',
		'src/common/editor/scape-project.js',
		'src/common/editor/storage/media-asset-write-repository.ts',
		'src/common/editor/storage/media-asset-chunk-records.ts',
		'tests/audio-editor-scape-streaming-video.test.ts',
		'tests/audio-editor-streaming-media-storage.test.ts',
		'tests/audio-editor-streaming-media-lifecycle.test.ts',
	],
	'bounded-direct-archive-publication': [
		'src/common/editor/scape-export-destination.ts',
		'src/common/editor/controller/native-scape-save.ts',
		'src/common/editor/file-save-stream.ts',
		'tests/audio-editor-scape-export-destination.test.ts',
		'tests/audio-editor-native-scape-save.test.ts',
		'tests/browser/audio-editor-scape-direct-save.spec.js',
	],
};

async function readMatrix() {
	return JSON.parse(await readFile(matrixUrl, 'utf8'));
}

test('security matrix covers the production threat-model surfaces without promoting gaps', async () => {
	const matrix = await readMatrix();
	const risks = new Map(matrix.risks.map((risk) => [risk.id, risk]));

	assert.equal(matrix.schemaVersion, 1);
	assert.match(matrix.groundedAt, /^\d{4}-\d{2}-\d{2}$/u);
	assert.ok(Date.parse(`${matrix.groundedAt}T00:00:00Z`) <= Date.now());
	assert.deepEqual(Object.keys(matrix.roadmapThreatCoverage).sort(), [...ROADMAP_THREAT_AREAS].sort());
	assert.equal(risks.size, matrix.risks.length, 'risk IDs must be unique');

	for (const area of ROADMAP_THREAT_AREAS) {
		const riskIds = matrix.roadmapThreatCoverage[area];
		assert.ok(riskIds.length > 0, `${area} must map to a risk`);
		for (const riskId of riskIds) assert.ok(risks.has(riskId), `${area} references unknown risk ${riskId}`);
	}

	const expectedStatuses = {
		'external-project-document-validation': 'partial',
		'external-media-parser-bounds': 'partial',
		'scape-archive-structure-integrity': 'enforced',
		'scape-archive-expansion': 'enforced',
		'electron-renderer-ipc-boundary': 'enforced',
		'desktop-static-resource-paths': 'enforced',
		'desktop-read-path-capabilities': 'partial',
		'desktop-write-path-capabilities': 'partial',
		'nyquist-untrusted-code-runtime': 'enforced',
		'reviewed-web-effect-packages': 'planned',
		'native-helper-processes': 'planned',
		'native-plugin-hosting': 'planned',
		'long-job-cancellation': 'partial',
		'runtime-supply-chain': 'partial',
	};
	assert.deepEqual(
		Object.fromEntries(matrix.risks.map((risk) => [risk.id, risk.status])),
		expectedStatuses,
	);

	for (const risk of matrix.risks) {
		assert.match(risk.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
		assert.ok(STATUS_VALUES.includes(risk.status), `${risk.id} has an invalid status`);
		assert.ok(DISPOSITION_VALUES.includes(risk.releaseDisposition), `${risk.id} has an invalid disposition`);
		assert.ok(risk.boundaryIds.length > 0, `${risk.id} needs a trust boundary`);
		assert.ok(risk.assets.length > 0, `${risk.id} needs a protected asset`);
		assert.ok(risk.currentControls.length > 0, `${risk.id} needs a current control or surface fence`);

		if (risk.status === 'enforced') {
			assert.equal(risk.releaseDisposition, 'qualified-current-surface', risk.id);
			assert.deepEqual(risk.residualRisks, [], `${risk.id} must be narrowly scoped if enforced`);
			for (const control of risk.currentControls) {
				const kinds = new Set(control.evidence.map(({ kind }) => kind));
				assert.ok(kinds.has('implementation'), `${risk.id}/${control.id} needs implementation evidence`);
				assert.ok(kinds.has('test'), `${risk.id}/${control.id} needs test evidence`);
			}
		}
		if (risk.status === 'partial' || risk.status === 'release-blocked') {
			assert.ok(risk.residualRisks.length > 0, `${risk.id} must record residual risk`);
			for (const residual of risk.residualRisks) {
				assert.ok(residual.requiredControl.length > 0, `${risk.id}/${residual.id} needs a required control`);
				assert.ok(residual.acceptanceCriteria.length > 0, `${risk.id}/${residual.id} needs acceptance criteria`);
			}
		}
		if (risk.status === 'planned') {
			assert.equal(risk.releaseDisposition, 'surface-disabled', risk.id);
			assert.ok(risk.residualRisks.length > 0, `${risk.id} needs enablement criteria`);
		}
	}
});

test('planned native and plug-in surfaces stay disabled and portable archive controls are qualified', async () => {
	const matrix = await readMatrix();
	const risks = new Map(matrix.risks.map((risk) => [risk.id, risk]));

	for (const riskId of ['reviewed-web-effect-packages', 'native-helper-processes', 'native-plugin-hosting']) {
		const risk = risks.get(riskId);
		assert.equal(risk.status, 'planned');
		assert.equal(risk.releaseDisposition, 'surface-disabled');
	}

	const archiveStructure = risks.get('scape-archive-structure-integrity');
	assert.equal(archiveStructure.status, 'enforced');
	assert.deepEqual(archiveStructure.residualRisks, []);
	const sourceBijection = archiveStructure.currentControls.find(
		({ id }) => id === 'migrated-project-source-bijection',
	);
	assert.ok(sourceBijection);
	for (const path of [
		'src/common/editor/scape-project-assets.ts',
		'src/common/editor/scape-project.js',
		'tests/audio-editor-scape-project-assets.test.ts',
		'tests/audio-editor-scape-archive-envelope.test.ts',
		'tests/audio-editor-scape-project.test.js',
	]) {
		assert.ok(
			sourceBijection.evidence.some((item) => item.path === path),
			`project source bijection needs evidence from ${path}`,
		);
	}
	assert.match(sourceBijection.summary, /equal source\/descriptor counts.*case-sensitive source IDs.*audio\/video kinds.*before.*storage call/iu);

	const archiveExpansion = risks.get('scape-archive-expansion');
	assert.equal(archiveExpansion.status, 'enforced');
	assert.equal(archiveExpansion.releaseGate.status, 'satisfied');
	assert.deepEqual(
		[...archiveExpansion.releaseGate.requiredControlIds].sort(),
		[...PENDING_ARCHIVE_EXPANSION_GATES].sort(),
	);
	const implementedControls = new Map(archiveExpansion.currentControls.map((control) => [control.id, control]));
	for (const controlId of IMPLEMENTED_ARCHIVE_PREFLIGHT_CONTROLS) {
		const control = implementedControls.get(controlId);
		assert.ok(control, `${controlId} must remain recorded as implemented`);
		assert.ok(
			control.evidence.some(({ path }) => path === 'src/common/editor/scape-archive-envelope.ts'),
			`${controlId} needs envelope implementation evidence`,
		);
		assert.ok(
			control.evidence.some(({ path }) => path === 'tests/audio-editor-scape-archive-envelope.test.ts'),
			`${controlId} needs envelope test evidence`,
		);
	}
	for (const [controlId, paths] of Object.entries(IMPLEMENTED_ARCHIVE_EXPANSION_CONTROLS)) {
		const control = implementedControls.get(controlId);
		assert.ok(control, `${controlId} must be recorded as implemented`);
		for (const path of paths) assert.ok(
			control.evidence.some((item) => item.path === path),
			`${controlId} needs evidence from ${path}`,
		);
	}
	assert.match(
		implementedControls.get('zipjs-local-header-and-pairwise-overlap-preflight').summary,
		/pairwise entry-range overlap/iu,
	);
	assert.match(
		implementedControls.get('local-header-and-overlap-validation').summary,
		/33 MiB.*exact classic\/Zip64.*data descriptor.*before zip\.js construction.*greater-than-4-GiB/iu,
	);
	assert.match(
		implementedControls.get('compression-ratio-or-store-policy').summary,
		/central-directory.*ZIP STORE.*before.*body reads/iu,
	);
	assert.match(
		implementedControls.get('bounded-streaming-media-extraction').summary,
		/4 MiB.*awaited transactional storage write.*native Blob chunks.*64 MiB/iu,
	);
	assert.match(
		implementedControls.get('bounded-direct-archive-publication').summary,
		/4 MiB.*independent byte counts.*File System Access.*desktop.*512 MiB/iu,
	);
	const residuals = new Map(archiveExpansion.residualRisks.map((risk) => [risk.id, risk]));
	assert.equal(residuals.has('compression-amplification-policy'), false);
	assert.equal(residuals.has('incomplete-zip-layout-validation'), false);
	const cancellationControl = implementedControls.get('abort-signal-propagation-and-rollback');
	assert.ok(cancellationControl, 'tested archive cancellation must remain recorded as implemented');
	for (const path of [
		'src/common/editor/scape-archive-reader.ts',
		'src/common/editor/scape-import-transaction.ts',
		'src/common/editor/scape-export-destination.ts',
		'src/common/editor/storage/source-write-repository.ts',
		'tests/audio-editor-scape-cancellation.test.ts',
		'tests/audio-editor-source-read-cancellation.test.ts',
		'tests/audio-editor-source-write-cancellation.test.ts',
		'tests/audio-editor-native-project-service.test.ts',
		'tests/audio-editor-file-service.test.js',
	]) {
		assert.ok(
			cancellationControl.evidence.some((item) => item.path === path),
			`archive cancellation needs evidence from ${path}`,
		);
	}
	assert.ok(implementedControls.has('bounded-streaming-media-extraction'));
	const cancellation = risks.get('long-job-cancellation');
	assert.ok(cancellation.currentControls.some(({ id }) => id === 'streamed-media-maintenance-abort'));
	assert.ok(cancellation.currentControls.some(({ id }) => id === 'direct-scape-save-rollback'));
	const stagingLeases = cancellation.currentControls.find(
		({ id }) => id === 'cross-context-streamed-media-staging-leases',
	);
	assert.ok(stagingLeases);
	for (const path of [
		'src/common/editor/storage/media-asset-staging-schema.ts',
		'src/common/editor/storage/media-asset-staging-repository.ts',
		'src/common/editor/storage/media-asset-staged-sink.ts',
		'src/common/editor/storage/media-asset-disposal-repository.ts',
		'src/common/editor/storage/media-asset-write-repository.ts',
		'src/common/editor/storage/retention-repository.ts',
		'tests/audio-editor-cross-context-media-lifecycle.test.ts',
		'tests/audio-editor-media-asset-disposal.test.ts',
		'tests/browser/audio-editor-storage-migration.spec.js',
	]) assert.ok(stagingLeases.evidence.some((item) => item.path === path));
	const digestBackfill = cancellation.currentControls.find(
		({ id }) => id === 'lazy-legacy-media-digest-backfill',
	);
	assert.ok(digestBackfill);
	for (const path of [
		'src/common/editor/storage/indexeddb-backend.ts',
		'src/common/editor/storage/media-content-provenance.ts',
		'src/common/editor/storage/media-asset-digest-backfill.ts',
		'src/common/editor/storage/media-content-digest.ts',
		'src/common/editor/storage/media-records.ts',
		'tests/audio-editor-media-digest-backfill.test.ts',
		'tests/audio-editor-derivative-cache-schema.test.ts',
		'tests/browser/audio-editor-storage-migration.spec.js',
	]) assert.ok(digestBackfill.evidence.some((item) => item.path === path));
	assert.match(
		digestBackfill.summary,
		/schema v6.*spoofable provenance.*no inherited hash.*version-zero Web-Crypto content claim.*bounded four-MiB reads.*token-checked compare-and-set.*stale delete or replacement/iu,
	);
	assert.ok(cancellation.residualRisks.some(
		({ id }) => id === 'legacy-media-digest-lifecycle-quiescence',
	));
	assert.equal(
		cancellation.residualRisks.some(({ id }) => id === 'cross-context-storage-maintenance'),
		false,
	);
	const desktopWrite = risks.get('desktop-write-path-capabilities');
	const saveShutdown = desktopWrite.currentControls.find(
		({ id }) => id === 'terminal-save-shutdown-quiescence',
	);
	assert.ok(saveShutdown);
	for (const path of [
		'desktop/save-targets.js',
		'desktop/main.mjs',
		'desktop/application-lifecycle.ts',
		'tests/desktop-save.test.js',
		'tests/desktop-application-lifecycle.test.ts',
	]) assert.ok(saveShutdown.evidence.some((item) => item.path === path));
	assert.match(
		saveShutdown.summary,
		/synchronously rejects new target and save-session admission.*sync-and-rename.*late-opened staging.*idempotent disposal barrier.*rejects on unacknowledged handle close or staging removal/iu,
	);
});

test('security claims point to checked-in implementation and verification evidence', async () => {
	const matrix = await readMatrix();
	const boundaries = new Map(matrix.boundaries.map((boundary) => [boundary.id, boundary]));
	assert.equal(boundaries.size, matrix.boundaries.length, 'boundary IDs must be unique');

	const evidence = [];
	for (const boundary of matrix.boundaries) {
		assert.match(boundary.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
		assert.ok(boundary.entryPoints.length > 0, `${boundary.id} needs an entry point or explicit fence`);
		evidence.push(...boundary.evidence);
	}
	for (const risk of matrix.risks) {
		for (const boundaryId of risk.boundaryIds) assert.ok(boundaries.has(boundaryId), `${risk.id} references ${boundaryId}`);
		for (const control of risk.currentControls) {
			assert.match(control.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
			assert.ok(control.summary.length > 0, `${risk.id}/${control.id} needs a summary`);
			assert.ok(control.evidence.length > 0, `${risk.id}/${control.id} needs evidence`);
			evidence.push(...control.evidence);
		}
	}

	for (const item of evidence) {
		assert.ok(EVIDENCE_KINDS.includes(item.kind), `invalid evidence kind ${item.kind}`);
		assert.ok(item.path !== matrix.modelDocument, 'the threat model is not implementation evidence');
		assert.notEqual(item.path, 'roadmap.md', 'the roadmap is not implementation evidence');
		await assert.doesNotReject(
			access(new URL(`../${item.path.split('#')[0]}`, import.meta.url)),
			`Missing security evidence: ${item.path}`,
		);
	}
});

test('threat-model documentation defines the limits of enforced controls', async () => {
	const matrix = await readMatrix();
	const documentationUrl = new URL(`../${matrix.modelDocument}`, import.meta.url);
	const documentation = await readFile(documentationUrl, 'utf8');

	for (const risk of matrix.risks) assert.match(documentation, new RegExp(`\\b${risk.id}\\b`, 'u'));
	assert.match(documentation, /enforced does not mean risk-free/iu);
	assert.match(documentation, /workers? provide fault isolation, not an operating-system security boundary/iu);
	assert.match(documentation, /native plug-ins? execute arbitrary code with the user account's authority/iu);
	assert.match(documentation, /local operating-system compromise is out of scope/iu);
});

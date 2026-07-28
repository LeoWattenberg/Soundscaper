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
const PENDING_ARCHIVE_EXPANSION_GATES = [
	'bounded-streaming-media-extraction',
	'compression-ratio-or-store-policy',
	'cumulative-actual-expanded-byte-limit',
	'local-header-and-overlap-validation',
	'safe-pcm-frame-arithmetic',
];

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
		'scape-archive-structure-integrity': 'partial',
		'scape-archive-expansion': 'release-blocked',
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

test('planned native and plug-in surfaces stay disabled and archive expansion stays release-blocked', async () => {
	const matrix = await readMatrix();
	const risks = new Map(matrix.risks.map((risk) => [risk.id, risk]));

	for (const riskId of ['reviewed-web-effect-packages', 'native-helper-processes', 'native-plugin-hosting']) {
		const risk = risks.get(riskId);
		assert.equal(risk.status, 'planned');
		assert.equal(risk.releaseDisposition, 'surface-disabled');
	}

	const archiveExpansion = risks.get('scape-archive-expansion');
	assert.equal(archiveExpansion.status, 'release-blocked');
	assert.equal(archiveExpansion.releaseGate.status, 'pending');
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
	for (const gateId of PENDING_ARCHIVE_EXPANSION_GATES) {
		assert.equal(implementedControls.has(gateId), false, `${gateId} is still a qualification gate`);
	}
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

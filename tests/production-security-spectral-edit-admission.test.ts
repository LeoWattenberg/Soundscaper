/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

interface SecurityEvidence {
	readonly kind: string;
	readonly path: string;
}

interface SecurityControl {
	readonly id: string;
	readonly summary: string;
	readonly evidence: readonly SecurityEvidence[];
}

interface SecurityResidual {
	readonly id: string;
	readonly exposure: string;
	readonly requiredControl: string;
	readonly ownerMilestone: string;
	readonly acceptanceCriteria: readonly string[];
}

interface SecurityRisk {
	readonly id: string;
	readonly status: string;
	readonly currentControls: readonly SecurityControl[];
	readonly residualRisks: readonly SecurityResidual[];
}

interface SecurityMatrix {
	readonly modelDocument: string;
	readonly risks: readonly SecurityRisk[];
}

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);

const EXPECTED_EVIDENCE = [
	{ kind: 'implementation', path: 'src/common/editor/spectral-edit-admission.ts' },
	{ kind: 'implementation', path: 'src/common/editor/controller/effect-audio-service.ts' },
	{ kind: 'implementation', path: 'src/common/editor/controller/effect-result-service.ts' },
	{ kind: 'implementation', path: 'src/common/editor/controller/selection-effect-worker-service.ts' },
	{ kind: 'implementation', path: 'src/common/editor/spectral-edit-worker.js' },
	{ kind: 'implementation', path: 'src/common/editor/spectral-edit.js' },
	{ kind: 'implementation', path: 'src/common/editor/pffft.js' },
	{ kind: 'test', path: 'tests/audio-editor-spectral-edit-admission.test.ts' },
	{ kind: 'test', path: 'tests/audio-editor-effect-audio-service.test.ts' },
	{ kind: 'test', path: 'tests/audio-editor-effect-result-service.test.ts' },
	{ kind: 'test', path: 'tests/audio-editor-selection-effect-worker-service.test.ts' },
] as const;

test('spectral edit admission remains narrowly evidenced and documented', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8')) as SecurityMatrix;
	const cancellation = matrix.risks.find(({ id }) => id === 'long-job-cancellation');
	assert.ok(cancellation, 'long-job-cancellation risk is required');
	assert.equal(cancellation.status, 'partial');

	const admission = cancellation.currentControls.find(
		({ id }) => id === 'bounded-spectral-edit-useful-binary',
	);
	assert.ok(admission, 'bounded spectral-edit useful-binary control is required');
	for (const expected of EXPECTED_EVIDENCE) {
		assert.ok(
			admission.evidence.some(
				({ kind, path }) => kind === expected.kind && path === expected.path,
			),
			`spectral-edit admission needs ${expected.kind} evidence from ${expected.path}`,
		);
	}
	assert.match(admission.summary, /non-raiseable 256 MiB.*lower-only.*useful-binary/isu);
	assert.match(admission.summary, /before.*storage preflight.*dry render.*worker.*retention.*persistence/isu);
	assert.match(admission.summary, /earlier completed outputs.*dry.*transfer copy.*equal-shape output/isu);
	assert.match(admission.summary, /two.*Float64.*Hann.*real.*imaginary.*PFFFT.*input.*output.*work/isu);
	assert.match(admission.summary, /worker boundary.*before.*FFT initialization.*copying.*worker creation/isu);
	assert.match(admission.summary, /1–32.*tight.*distinct.*non-shared.*non-resizable.*exact.*channel.*frame/isu);
	assert.match(admission.summary, /task.*project.*current.*persistence.*await.*before.*commit/isu);

	const residual = cancellation.residualRisks.find(
		({ id }) => id === 'render-worker-resident-set-accounting',
	);
	assert.ok(residual, 'render and worker resident-set residual is required');
	assert.equal(residual.ownerMilestone, '2');
	assert.match(residual.exposure, /spectral.*useful-binary upper bound.*not.*browser heap.*RSS.*GC/isu);
	assert.match(residual.exposure, /no product-wide reservation.*concurrent.*overlap/isu);
	assert.match(residual.exposure, /persistence.*AudioBuffer.*generic selection effects.*injected renderers/isu);
	assert.match(residual.exposure, /worker.*message objects.*PFFFT module heap.*setup.*concurrent/isu);
	assert.match(residual.requiredControl, /end-to-end.*browser.*worker.*renderer.*RSS/isu);
	assert.ok(residual.acceptanceCriteria.length > 0);

	const threatModel = await readFile(new URL(`../${matrix.modelDocument}`, import.meta.url), 'utf8');
	const scope = spectralEditDocumentation(threatModel, 'production threat model');
	assert.match(scope, /non-raiseable 256 MiB.*lower-only.*useful-binary/isu);
	assert.match(scope, /before.*storage preflight.*dry render.*worker.*retention.*persistence/isu);
	assert.match(scope, /earlier completed outputs.*dry.*transfer copy.*equal-shape output/isu);
	assert.match(scope, /two.*Float64.*Hann.*real.*imaginary.*PFFFT.*input.*output.*work/isu);
	assert.match(scope, /worker boundary.*before.*FFT initialization.*copying.*worker creation/isu);
	assert.match(scope, /1–32.*tight.*distinct.*non-shared.*non-resizable.*exact.*channel.*frame/isu);
	assert.match(scope, /task.*project.*current.*persistence.*await.*before.*commit/isu);
	assert.match(scope, /upper bound.*not.*browser[- ]heap.*RSS.*GC.*product-wide reservation/isu);
	assert.match(scope, /persistence.*AudioBuffer.*generic selection effects.*injected renderers/isu);
	assert.match(scope, /worker.*message objects.*PFFFT module heap.*setup.*concurrent/isu);
});

function spectralEditDocumentation(documentation: string, name: string): string {
	const marker = /Maintained spectral gain\/delete selection/iu.exec(documentation);
	assert.ok(marker, `${name} must document maintained spectral-edit admission`);
	const remainder = documentation.slice(marker.index);
	const nextControl = /Central `OfflineAudioContext` render output/iu.exec(remainder);
	assert.ok(nextControl, `${name} must retain central offline-render documentation`);
	return remainder.slice(0, nextControl.index);
}

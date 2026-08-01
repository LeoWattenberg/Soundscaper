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
const roadmapUrl = new URL('../roadmap.md', import.meta.url);

const EXPECTED_EVIDENCE = [
	{ kind: 'implementation', path: 'src/common/editor/engine/offline-render-admission.ts' },
	{ kind: 'implementation', path: 'src/common/editor/engine/rendering.ts' },
	{ kind: 'implementation', path: 'src/common/editor/export-render-admission.ts' },
	{ kind: 'implementation', path: 'src/common/editor/export.js' },
	{ kind: 'test', path: 'tests/audio-editor-offline-render-admission.test.ts' },
	{ kind: 'test', path: 'tests/audio-editor-export-render-admission.test.ts' },
	{ kind: 'test', path: 'tests/audio-editor-export-strategy-admission.test.ts' },
] as const;

test('central offline-render output admission remains narrowly evidenced and documented', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8')) as SecurityMatrix;
	const cancellation = matrix.risks.find(({ id }) => id === 'long-job-cancellation');
	assert.ok(cancellation, 'long-job-cancellation risk is required');
	assert.equal(cancellation.status, 'partial');

	const admission = cancellation.currentControls.find(
		({ id }) => id === 'bounded-offline-render-output-pcm',
	);
	assert.ok(admission, 'bounded offline-render output control is required');
	for (const expected of EXPECTED_EVIDENCE) {
		assert.ok(
			admission.evidence.some(
				({ kind, path }) => kind === expected.kind && path === expected.path,
			),
			`offline-render admission needs ${expected.kind} evidence from ${expected.path}`,
		);
	}
	assert.match(admission.summary, /non-raiseable 256 MiB.*useful-binary.*lower-only/isu);
	assert.match(admission.summary, /exact Float32 output.*crop\s+copy.*coexist/isu);
	assert.match(admission.summary, /software-renderer fallback.*(?:before|precedes).*context factory/isu);
	assert.match(admission.summary, /context length.*sample rate.*before.*worklets.*graph.*source/isu);
	assert.match(admission.summary, /rendered AudioBuffer.*channels.*length.*sample rate.*Float32/isu);
	assert.match(admission.summary, /createExportPlan.*mobile.*output.*live[- ]PCM.*heuristics/isu);
	assert.match(
		admission.summary,
		/project-rate requested frames.*effective\s+pre-roll.*(?:maximum|max).*mix.*per-stem.*graph\s+latency.*actual\s+render\s+width/isu,
	);
	assert.match(
		admission.summary,
		/known central-limit refusals.*realtime.*before.*offline\s+render.*context\s+work/isu,
	);
	assert.match(admission.summary, /exact boundary.*admitted/isu);
	assert.match(admission.summary, /direct\s+engine\s+callers.*no-context software-renderer fallback/isu);

	const residual = cancellation.residualRisks.find(
		({ id }) => id === 'render-worker-resident-set-accounting',
	);
	assert.ok(residual, 'render and worker resident-set residual is required');
	assert.equal(residual.ownerMilestone, '2');
	assert.match(residual.exposure, /OfflineAudioContext output\/crop.*not.*browser heap.*RSS.*GC/isu);
	assert.match(residual.exposure, /no product-wide reservation.*overlap/isu);
	assert.match(residual.exposure, /factory.*allocate before.*geometry.*checked/isu);
	assert.match(residual.exposure, /cancellation.*not prove.*startRendering.*stopped/isu);
	assert.match(
		residual.exposure,
		/export strategy.*central.*admission.*before.*offline\s+render.*context\s+work/isu,
	);
	assert.match(residual.exposure, /direct\s+engine\s+callers.*software.*fallback/isu);
	assert.match(residual.requiredControl, /end-to-end.*browser.*worker.*renderer.*RSS/isu);
	assert.ok(residual.acceptanceCriteria.length > 0);

	const threatModel = await readFile(new URL(`../${matrix.modelDocument}`, import.meta.url), 'utf8');
	const roadmap = await readFile(roadmapUrl, 'utf8');
	for (const [name, documentation] of [
		['production threat model', threatModel],
		['roadmap', roadmap],
	] as const) {
		const scope = offlineRenderDocumentation(documentation, name);
		assert.match(scope, /non-raiseable 256 MiB.*lower-only/isu);
		assert.match(scope, /exact.*Float32.*context.*output.*crop\s+copy.*coexist/isu);
		assert.match(scope, /software-renderer fallback.*(?:before|precedes).*context factory/isu);
		assert.match(scope, /context.*length.*sample rate.*before.*worklets.*graph.*source/isu);
		assert.match(scope, /rendered.*channel.*length.*sample rate.*Float32.*before.*(?:return|crop)/isu);
		assert.match(scope, /source.*reverse.*graph.*worklet.*WASM.*browser[- ]heap.*RSS.*GC/isu);
		assert.match(scope, /(?:separate|other).*engines?.*overlap.*product-wide reservation/isu);
		assert.match(scope, /(?:abort|cancellation).*not.*prove.*startRendering\(\).*stop/isu);
		assert.match(scope, /createExportPlan.*mobile.*output.*live[- ]PCM.*heuristics/isu);
		assert.match(
			scope,
			/project-rate requested frames.*effective\s+pre-roll.*(?:maximum|max).*mix.*per-stem.*graph\s+latency.*actual\s+render\s+width/isu,
		);
		assert.match(
			scope,
			/known central-limit refusals.*realtime.*before.*offline\s+render.*context\s+work/isu,
		);
		assert.match(scope, /exact boundary.*admitted/isu);
		assert.match(scope, /direct\s+engine\s+callers.*no-context software-renderer fallback/isu);
	}
});

function offlineRenderDocumentation(documentation: string, name: string): string {
	const marker = /Central `OfflineAudioContext` render output/iu.exec(documentation);
	assert.ok(marker, `${name} must document central offline-render output admission`);
	return documentation.slice(marker.index, marker.index + 5_000);
}

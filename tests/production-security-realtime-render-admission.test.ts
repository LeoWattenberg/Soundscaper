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
	readonly ownerMilestone: string;
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

const EXPECTED_EVIDENCE = [
	{ kind: 'implementation', path: 'src/common/editor/pcm-sink-admission.ts' },
	{ kind: 'implementation', path: 'src/common/editor/pcm-sink.js' },
	{ kind: 'implementation', path: 'src/common/editor/render-capture-worklet.js' },
	{ kind: 'implementation', path: 'src/common/editor/engine/realtime-render-capture.ts' },
	{ kind: 'implementation', path: 'src/common/editor/engine/rendering.ts' },
	{ kind: 'test', path: 'tests/audio-editor-realtime-render-admission.test.ts' },
	{ kind: 'test', path: 'tests/audio-editor-render-capture-worklet.test.ts' },
	{ kind: 'test', path: 'tests/audio-editor-pcm-sink.test.js' },
	{ kind: 'test', path: 'tests/audio-editor-realtime-stream-underrun.test.ts' },
] as const;

test('realtime render PCM admission remains narrowly evidenced and documented', async () => {
	const matrix = JSON.parse(await readFile(
		new URL('../config/production-security-matrix.json', import.meta.url),
		'utf8',
	)) as SecurityMatrix;
	const cancellation = matrix.risks.find(({ id }) => id === 'long-job-cancellation');
	assert.ok(cancellation, 'long-job-cancellation risk is required');
	assert.equal(cancellation.status, 'partial');
	const admission = cancellation.currentControls.find(
		({ id }) => id === 'bounded-realtime-render-pcm',
	);
	assert.ok(admission, 'bounded realtime-render PCM control is required');
	for (const expected of EXPECTED_EVIDENCE) {
		assert.ok(admission.evidence.some(
			({ kind, path }) => kind === expected.kind && path === expected.path,
		), `realtime-render admission needs ${expected.kind} evidence from ${expected.path}`);
	}
	assert.match(admission.summary, /before AudioContext construction.*1–32 channels.*128–16,384 frames.*2 MiB/isu);
	assert.match(admission.summary, /non-raiseable.*512 packets.*8,388,608.*32 MiB.*Float32/isu);
	assert.match(admission.summary, /smaller of 64 packets.*byte-bound/isu);
	assert.match(admission.summary, /producer credit before transfer.*fails closed.*without posting PCM/isu);
	assert.match(admission.summary, /after the sink promise settles.*count\/frame\/byte.*references.*dropped/isu);
	assert.match(admission.summary, /32 MiB.*plus one maximum 2 MiB.*staging or replacement/isu);
	assert.match(admission.summary, /exact channel width.*tight distinct non-shared fixed ArrayBuffer.*declared frame.*contiguous offset.*completion/isu);

	const residual = cancellation.residualRisks.find(
		({ id }) => id === 'render-worker-resident-set-accounting',
	);
	assert.ok(residual, 'render and worker resident-set residual is required');
	assert.equal(residual.ownerMilestone, '2');
	assert.match(residual.exposure, /realtime.*32 MiB.*2 MiB.*not account.*structured-clone.*AudioContext.*graph.*encoder.*WASM/isu);
	assert.match(residual.exposure, /sink.*retain.*after.*promise settles.*outside.*queue contract/isu);
	assert.match(residual.exposure, /job-local.*product-wide reservation.*concurrent.*overlap/isu);

	const threatModel = await readFile(
		new URL(`../${matrix.modelDocument}`, import.meta.url),
		'utf8',
	);
	const scope = realtimeRenderDocumentation(threatModel, 'production threat model');
	assert.match(scope, /before.*AudioContext.*1–32 channels.*128–16,384.*2 MiB/isu);
	assert.match(scope, /non-raiseable.*512 packets.*8,388,608.*32 MiB.*Float32/isu);
	assert.match(scope, /credit before.*transfer.*fails closed/isu);
	assert.match(scope, /after.*sink promise settles.*count\/frame\/byte.*references.*drop/isu);
	assert.match(scope, /32 MiB.*plus one.*2 MiB.*staging or replacement/isu);
	assert.match(scope, /exact.*channel.*tight distinct non-shared fixed.*ArrayBuffer.*frame.*offset.*completion/isu);
	assert.match(scope, /not.*structured-clone.*AudioContext.*graph.*source.*encoder.*WASM.*heap.*RSS.*GC/isu);
	assert.match(scope, /sink.*retain.*after.*promise settles.*outside.*queue contract/isu);
	assert.match(scope, /concurrent render.*overlap.*product-wide reservation/isu);
});

function realtimeRenderDocumentation(documentation: string, name: string): string {
	const marker = /Maintained realtime worklet-to-sink rendering/iu.exec(documentation);
	assert.ok(marker, `${name} must document maintained realtime-render admission`);
	return documentation.slice(marker.index, marker.index + 4_500);
}

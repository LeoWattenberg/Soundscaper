/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createExportPlan } from '../src/common/editor/export.js';
import { createAudioEditorProjectV2 } from '../src/common/editor/project-v2.js';

function project() {
	return createAudioEditorProjectV2({
		id: 'normalized-delivery',
		title: 'Normalized delivery',
		now: '2026-08-17T00:00:00.000Z',
		sampleRate: 48_000,
		tracks: [
			{ type: 'audio', id: 'one', name: 'One' },
			{ type: 'audio', id: 'two', name: 'Two' },
		],
	});
}

const options = {
	format: 'wav' as const,
	bitDepth: 24,
	includeTail: false,
	range: { startFrame: 0, endFrame: 48_000 },
	date: '2026-08-17',
};

test('the target rides on the plan, so no encoder ever receives a loudness flag', () => {
	const plan = createExportPlan(project(), { ...options, loudnessNormalization: 'ebu-r128' });
	assert.deepEqual(plan.loudnessNormalization, { integratedLufs: -23, truePeakCeilingDb: -1 });
	// The encoding settings the format encoder is handed must say nothing about it.
	assert.equal('loudnessNormalization' in plan.encoding, false);
});

test('an explicit target survives the plan exactly as given', () => {
	const plan = createExportPlan(project(), {
		...options,
		loudnessNormalization: { integratedLufs: -16, truePeakCeilingDb: -1.5 },
	});
	assert.deepEqual(plan.loudnessNormalization, { integratedLufs: -16, truePeakCeilingDb: -1.5 });
});

test('a delivery that did not ask for normalization carries no target', () => {
	assert.equal(createExportPlan(project(), options).loudnessNormalization, null);
});

test('every format that can be delivered offline can be normalized identically', () => {
	// Normalization is a plan step, so it must not be available for some formats
	// and quietly absent for others.
	for (const format of ['wav', 'bwf', 'aiff', 'flac', 'mp3', 'opus'] as const) {
		const plan = createExportPlan(project(), { ...options, format, loudnessNormalization: 'ebu-r128' });
		assert.deepEqual(
			plan.loudnessNormalization,
			{ integratedLufs: -23, truePeakCeilingDb: -1 },
			`${format} must carry the same target`,
		);
	}
});

test('stems refuse normalization rather than drifting apart', () => {
	// Normalizing each stem to the same integrated target moves them relative to
	// one another, so their sum stops being the normalized mix.
	assert.throws(
		() => createExportPlan(project(), { ...options, mode: 'stems', loudnessNormalization: 'ebu-r128' }),
		/mix-only.*sum to the normalized mix/iu,
	);
	// And stems without a target are unaffected.
	assert.equal(createExportPlan(project(), { ...options, mode: 'stems' }).loudnessNormalization, null);
});

test('a delivery too large for the offline render refuses rather than skipping the gain', () => {
	// The realtime stream encodes as it renders, so it never holds the whole
	// delivery to measure. Writing an un-normalized file that claimed a target
	// is the outcome this refusal exists to prevent.
	const enormous = { ...options, livePcmBytes: Number.MAX_SAFE_INTEGER / 4 };
	assert.equal(createExportPlan(project(), enormous).render.strategy, 'realtime-stream');
	assert.throws(
		() => createExportPlan(project(), { ...enormous, loudnessNormalization: 'ebu-r128' }),
		/requires the offline render/iu,
	);
});

test('an unreadable target is refused at plan time, before anything renders', () => {
	assert.throws(
		() => createExportPlan(project(), { ...options, loudnessNormalization: { integratedLufs: -23 } }),
		/finite true-peak ceiling/u,
	);
	assert.throws(
		() => createExportPlan(project(), { ...options, loudnessNormalization: 'loud' }),
		/Unknown loudness normalization target/u,
	);
});

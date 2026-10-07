/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { GUIDE_FIXTURES } from '../handbook/guides/fixtures.mjs';
import { CLEAN_UP_WORKFLOW_GUIDES, EFFECT_WORKFLOW_GUIDES, VOLUME_WORKFLOW_GUIDES } from '../handbook/guides/soundscaper/restoration-and-level-workflows.mjs';
import { validateGuide } from '../handbook/guides/steps.mjs';

const groups = [
	{ guides: CLEAN_UP_WORKFLOW_GUIDES, ids: ['remove-a-narrow-frequency-band', 'restore-clipped-peaks', 'compress-long-pauses'] },
	{ guides: VOLUME_WORKFLOW_GUIDES, ids: ['normalize-to-an-rms-target'] },
	{ guides: EFFECT_WORKFLOW_GUIDES, ids: ['boost-a-selected-frequency-band', 'invert-polarity-for-cancellation'] },
];
const allGuides = groups.flatMap(({ guides }) => guides);

test('the six restoration and level workflows have validated reader-facing recipes', () => {
	for (const { guides, ids } of groups) assert.deepEqual(guides.map(({ id }) => id), ids);
	assert.equal(new Set(allGuides.map(({ id }) => id)).size, 6);
	for (const guide of allGuides) {
		validateGuide(guide, GUIDE_FIXTURES);
		assert.equal((guide.intro.match(/[.!?](?:\s|$)/gu) || []).length, 2, `${guide.id} needs a two-sentence introduction`);
		assert.equal(guide.tips.length, 2, `${guide.id} needs two practical tips`);
		assert.ok(guide.steps.some(({ kind }) => kind === 'play' || kind === 'check'), `${guide.id} needs a result check`);
		assert.doesNotMatch(JSON.stringify(guide), /guide-[a-z-]+\.wav|quarter point|halfway point/u);
	}
});

test('spectral delete and amplify use distinct time-frequency selections and direct dialog operations', () => {
	const remove = CLEAN_UP_WORKFLOW_GUIDES.find(({ id }) => id === 'remove-a-narrow-frequency-band');
	const boost = EFFECT_WORKFLOW_GUIDES.find(({ id }) => id === 'boost-a-selected-frequency-band');
	for (const [guide, operation, range] of [
		[remove, 'delete', { minimum: 200, maximum: 320 }],
		[boost, 'amplify', { minimum: 200, maximum: 320, gain: 4 }],
	]) {
		const visualization = guide.steps.find(({ kind }) => kind === 'track-menu');
		const selectedTime = guide.steps.find(({ kind }) => kind === 'select-range');
		const spectral = guide.steps.find(({ kind }) => kind === 'spectral-range');
		assert.deepEqual(visualization.path, ['Track visualization', 'Spectrogram']);
		assert.ok(selectedTime?.where, `${guide.id} explains which time span to select`);
		assert.deepEqual({ minimum: spectral.minimum, maximum: spectral.maximum, ...(operation === 'amplify' ? { gain: spectral.gain } : {}) }, range);
		assert.equal(spectral.operation, operation);
	}
});

test('clipped-peak repair uses Clip Fix controls and describes its limited restoration scope', () => {
	const guide = CLEAN_UP_WORKFLOW_GUIDES.find(({ id }) => id === 'restore-clipped-peaks');
	const repair = guide.steps.find(({ kind }) => kind === 'nyquist');
	assert.equal(repair.menu, 'Effect');
	assert.equal(repair.name, 'Clip Fix');
	assert.deepEqual(repair.fields, [
		{ label: 'Threshold of Clipping (%)', value: '95' },
		{ label: 'Reduce amplitude to allow for restored peaks (dB)', value: '-9' },
	]);
	assert.match(guide.intro, /short clipped peaks/u);
	assert.match(guide.tips.join(' '), /does not recreate missing detail in sustained distortion/u);
});

test('silence compression shortens excess pauses without deleting them', () => {
	const guide = CLEAN_UP_WORKFLOW_GUIDES.find(({ id }) => id === 'compress-long-pauses');
	const effect = guide.steps.find(({ kind }) => kind === 'effect');
	assert.equal(effect.group, 'Special');
	assert.equal(effect.name, 'Truncate Silence');
	assert.deepEqual(effect.settings, [
		{ label: 'Threshold', value: '-40' },
		{ label: 'Minimum silence', value: '0.5' },
		{ label: 'Action', option: 'Compress excess silence' },
		{ label: 'Compress to', value: '50' },
	]);
	assert.match(guide.steps.find(({ kind }) => kind === 'play').see, /pauses are shorter/u);
});

test('RMS normalization sets the RMS target and keeps stereo channels linked', () => {
	const guide = VOLUME_WORKFLOW_GUIDES[0];
	const effect = guide.steps.find(({ kind }) => kind === 'effect');
	assert.equal(effect.group, 'Volume and compression');
	assert.equal(effect.name, 'Loudness Normalization');
	assert.deepEqual(effect.settings, [
		{ label: 'Normalize', option: 'RMS' },
		{ label: 'Target RMS', value: '-20' },
		{ label: 'Normalize stereo channels independently', checked: false },
	]);
	assert.match(guide.steps.at(-1).see, /RMS target/u);
});

test('polarity inversion duplicates first and preserves the original while confirming cancellation', () => {
	const guide = EFFECT_WORKFLOW_GUIDES.find(({ id }) => id === 'invert-polarity-for-cancellation');
	assert.ok(guide.steps.find((entry) => entry.kind === 'track-menu' && /Duplicate/u.test(pathText(entry.path))));
	const invert = guide.steps.find(({ kind, name }) => kind === 'effect' && name === 'Invert');
	assert.equal(invert.group, 'Special');
	assert.equal(invert.direct, true);
	assert.match(guide.steps.at(-1).see, /they cancel/u);
});

function pathText(path) {
	return Array.isArray(path) ? path.join(' → ') : '';
}

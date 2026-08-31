import assert from 'node:assert/strict';
import test from 'node:test';

import {
	audacityParameterPresentation,
	audacityParameterVisible,
	effectPresetChoices,
	safeEffectLabel,
} from '../src/common/editor/ui/inspector/effect-helpers.ts';
import {
	compactFields,
	macroFileName,
	nonNegativeFrame,
	parseJsonChannelMapping,
	parseJsonObject,
	secondsInputToFrames,
} from '../src/common/editor/ui/inspector/inspector-helpers.ts';

const copy = {
	channelMatrixRequired: '{label} is required',
	channelMatrixShape: '{label} has the wrong shape',
	invalidFrameValue: 'Invalid frame',
	invalidTimeValue: 'Invalid time',
	mustBeJsonObject: '{label} must be an object',
	mustBeValidJson: '{label} must be valid JSON',
};

test('Inspector serialization helpers validate boundary input without UI state', () => {
	assert.deepEqual(parseJsonObject('{"artist":"Ada"}', 'Metadata', copy), { artist: 'Ada' });
	assert.deepEqual(parseJsonChannelMapping('{"channels":[[0,1]]}', 'Channels', copy), { channels: [[0, 1]] });
	assert.deepEqual(compactFields({ title: 'Song', artist: '', year: null, track: 3 }), { title: 'Song', track: 3 });
	assert.equal(macroFileName('  My noisy / macro  '), 'My-noisy-macro');
	assert.equal(secondsInputToFrames('1:02.5', copy, 48_000), 3_000_000);
	assert.throws(() => secondsInputToFrames('   ', copy, 48_000), /Invalid time/u);
	assert.throws(() => secondsInputToFrames(':', copy, 48_000), /Invalid time/u);
	assert.throws(() => secondsInputToFrames('1:', copy, 48_000), /Invalid time/u);
	assert.throws(() => nonNegativeFrame('', copy), /Invalid frame/u);
	assert.throws(() => parseJsonObject('[]', 'Metadata', copy), /Metadata must be an object/);
	assert.throws(() => parseJsonChannelMapping('{}', 'Channels', copy), /wrong shape/);
});

test('effect helpers keep labels, presets, and conditional controls deterministic', () => {
	const presets = effectPresetChoices([
		{ id: 'a', name: 'Warm' },
		{ id: 'b', name: 'Warm' },
	], 'None');
	assert.deepEqual(presets.map(({ id, label }) => ({ id, label })), [
		{ id: 'a', label: 'Warm' },
		{ id: 'b', label: 'Warm (2)' },
	]);
	assert.equal(safeEffectLabel({ type: 'missing', missing: { name: 'Old plug-in' } }, {
		missingEffectLabel: 'Unavailable: {name}',
		missingEffectUnknown: 'Unknown',
	}), 'Unavailable: Old plug-in');
	assert.equal(audacityParameterVisible({
		type: 'audacity-normalize',
		params: { applyGain: false },
	}, 'peakDb'), false);
	assert.equal(audacityParameterPresentation('audacity-amplify', 'gainDb'), 'slider');
});

test('a project-authored missing effect name cannot expand into its own label', () => {
	const missingCopy = { missingEffectLabel: 'Missing: {name}', missingEffectUnknown: 'Unknown' };
	assert.equal(
		safeEffectLabel({ type: 'missing', missing: { name: 'Reverb $& x' } }, missingCopy),
		'Missing: Reverb $& x',
	);
	assert.equal(
		safeEffectLabel({ type: 'missing', missing: { name: "Delay $' $` $$" } }, missingCopy),
		"Missing: Delay $' $` $$",
	);
	assert.equal(safeEffectLabel({ type: 'missing', missing: { name: '   ' } }, missingCopy), 'Missing: Unknown');
});

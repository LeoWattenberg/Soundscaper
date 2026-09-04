import assert from 'node:assert/strict';
import test from 'node:test';

import {
	audacityParameterPresentation,
	audacityParameterVisible,
	effectPresetChoices,
	safeEffectLabel,
} from '../src/common/editor/ui/inspector/effect-helpers.ts';
import {
	createAudioEditorEffectPresets,
	listAudioEditorEffectPresets,
} from '../src/common/editor/effect-presets.js';
import {
	clipPitchUnitToCents,
	compactFields,
	macroFileName,
	nonNegativeFrame,
	parseJsonChannelMapping,
	parseJsonObject,
	secondsInputToFrames,
} from '../src/common/editor/ui/inspector/inspector-helpers.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';

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

test('preset choices name the presets Audacity ships from the catalog', () => {
	const listPresets = listAudioEditorEffectPresets as unknown as (
		state: unknown,
		effectType: string,
	) => ReadonlyArray<Readonly<{ id: string; name: string; labelKey?: string; custom?: boolean }>>;
	const presets = listPresets(createAudioEditorEffectPresets(), 'audacity-reverb');
	const english = effectPresetChoices(presets, 'No preset', 'en');
	const german = effectPresetChoices(presets, 'Kein Preset', 'de');
	assert.equal(english.length, 18);
	// Factory presets are not the project's own, so the bar must not offer to
	// overwrite or delete one, and their names come from the copy catalog.
	assert.ok(english.every((choice) => choice.custom === false));
	assert.equal(english.find((choice) => choice.id.endsWith(':cathedral'))?.label, 'Cathedral');
	assert.equal(german.find((choice) => choice.id.endsWith(':cathedral'))?.label, 'Kathedrale');

	const mixed = effectPresetChoices([
		{ id: 'saved', name: 'Booth' },
		...presets,
	], 'No preset', 'en');
	assert.deepEqual(
		[mixed[0]?.label, mixed[0]?.custom],
		['Booth', true],
		'a preset the project saved stays a custom entry',
	);
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

const pitchCopy = {
	clipPitchRange: String(ENGLISH_COPY.clipPitchRange),
	clipPitchRangeSemitones: String(ENGLISH_COPY.clipPitchRangeSemitones),
};

test('an emptied pitch field is refused rather than read as no shift at all', () => {
	// Number('') is zero, so without an empty guard blanking the field committed
	// a perfectly valid nought cents and wiped the shift the clip carried.
	assert.throws(() => clipPitchUnitToCents('', 'semitones', pitchCopy), RangeError);
	assert.throws(() => clipPitchUnitToCents('   ', 'semitones', pitchCopy), RangeError);
	assert.throws(() => clipPitchUnitToCents(null, 'semitones', pitchCopy), RangeError);
	assert.throws(() => clipPitchUnitToCents('', 'percent', pitchCopy), RangeError);
	// A nought the reader typed on purpose is still a shift of none.
	assert.equal(clipPitchUnitToCents('0', 'semitones', pitchCopy), 0);
	assert.equal(clipPitchUnitToCents('0', 'percent', pitchCopy), 0);
	assert.equal(clipPitchUnitToCents('-0.07', 'semitones', pitchCopy), -7);
});

test('a pitch outside the octave is refused in the unit the field is labelled with', () => {
	assert.equal(clipPitchUnitToCents('12', 'semitones', pitchCopy), 1_200);
	assert.equal(clipPitchUnitToCents('-12', 'semitones', pitchCopy), -1_200);
	assert.throws(() => clipPitchUnitToCents('13', 'semitones', pitchCopy), /semitones/u);
	assert.throws(() => clipPitchUnitToCents('-24', 'semitones', pitchCopy), /−12 and \+12/u);
	// The field reads "Pitch (semitones, −12 to +12)", so cents name a unit the
	// reader is shown nowhere in the dialog.
	assert.equal(pitchCopy.clipPitchRangeSemitones, 'Clip pitch must be between −12 and +12 semitones.');
	assert.doesNotMatch(pitchCopy.clipPitchRangeSemitones, /cents|1200/u);
});

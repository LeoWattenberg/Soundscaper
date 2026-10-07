/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	advanceAudacityTrackSelection,
	audacityTrackRangeSelection,
} from '../src/common/editor/audacity-track-selection.ts';
import {
	spreadsheetBoolean,
	spreadsheetGain,
	spreadsheetNumber,
} from '../src/common/editor/clip-spreadsheet-values.ts';
import {
	AUDIO_EDITOR_COMMAND_SEARCH_ALIASES,
	flattenAudioEditorSearchMenus,
	normalizeAudioEditorSearchText,
	searchAudioEditorEntries,
} from '../src/common/editor/search.js';
import { findClipSilenceRegions } from '../src/common/editor/clip-silence-regions.ts';

test('track ranges retain the anchor after deduplicating IDs and rejecting missing focus', () => {
	assert.deepEqual(audacityTrackRangeSelection({
		trackIds: ['a', 'b', 'a', 'c'], focusedTrackId: 'a', selectedTrackIds: ['c'],
	}), ['c', 'a', 'b']);
	assert.deepEqual(audacityTrackRangeSelection({
		trackIds: [], focusedTrackId: null, selectedTrackIds: [],
	}), []);
	assert.deepEqual(audacityTrackRangeSelection({
		trackIds: ['a'], focusedTrackId: 'missing', selectedTrackIds: ['a'],
	}), []);
	assert.deepEqual(advanceAudacityTrackSelection({
		trackIds: ['a', 'b'], focusedTrackId: 'a', selectedTrackIds: ['missing'], direction: 1,
	}), { focusedTrackId: 'b', selectedTrackIds: ['a', 'b'] });
});

test('spreadsheet cells trim whitespace while preserving zero and rejecting empty numbers', () => {
	assert.equal(spreadsheetNumber(' \t0\n ', 0, 1, 'Value'), 0);
	assert.throws(() => spreadsheetNumber(' \t ', 0, 1, 'Value'), RangeError);
	assert.throws(() => spreadsheetNumber('NaN', 0, 1, 'Value'), RangeError);
	assert.equal(spreadsheetBoolean(' \tYeS\n '), true);
	assert.equal(spreadsheetBoolean(' \t0\n '), false);
	assert.throws(() => spreadsheetBoolean(''), RangeError);
	assert.equal(spreadsheetGain(' \t-InFiNiTy\n '), 0);
	assert.equal(spreadsheetGain(' \t-∞\n '), 0);
	assert.equal(spreadsheetGain(' 0 '), 1);
});

test('search separators collapse once and alias lists retain separate frozen identities', () => {
	assert.equal(normalizeAudioEditorSearchText(' \tÆther__Œuvre\n\n音 楽\u00a0!! '), 'aether oeuvre 音 楽');
	for (const [legacy, builtin] of [
		[AUDIO_EDITOR_COMMAND_SEARCH_ALIASES['audacity-change-pitch'], AUDIO_EDITOR_COMMAND_SEARCH_ALIASES['effect://builtin/change-pitch']],
		[AUDIO_EDITOR_COMMAND_SEARCH_ALIASES['audacity-change-tempo'], AUDIO_EDITOR_COMMAND_SEARCH_ALIASES['effect://builtin/change-tempo']],
	]) {
		assert.deepEqual(legacy, builtin);
		assert.notEqual(legacy, builtin);
		assert.ok(Object.isFrozen(legacy));
		assert.ok(Object.isFrozen(builtin));
	}
});

test('search keeps first-occurrence term order and leaves the supplied entries untouched', () => {
	const entries = flattenAudioEditorSearchMenus([{ label: ' Edit ', items: [{
		id: ' command ', label: ' Edit ', canonicalId: ' command ', shortcut: ' Ctrl+E ', onClick() {},
	}] }]);
	assert.deepEqual(entries[0]!.terms, ['Edit', 'command', 'Ctrl+E', 'Edit Edit']);
	assert.deepEqual(entries[0]!.paths, [['Edit', 'Edit']]);
	const original = [{ key: 'b', sourceOrder: 2 }, { key: 'a', sourceOrder: 1 }];
	const result = searchAudioEditorEntries(original, '', { limit: Number.NaN });
	assert.deepEqual(result, [original[1], original[0]]);
	assert.deepEqual(original.map(({ key }) => key), ['b', 'a']);
	assert.deepEqual(searchAudioEditorEntries(original, '', { limit: 0 }), []);
});

test('silence runs at a bounded scan end use the same minimum duration as interior runs', () => {
	const samples = new Float32Array(100).fill(0.5);
	samples.fill(0, 30, 50);
	const clip = { timelineStartFrame: 100, durationFrames: 100, sourceStartFrame: 0 };
	const buffer = { sampleRate: 1_000, numberOfChannels: 1, getChannelData: () => samples };
	assert.deepEqual(findClipSilenceRegions(clip, buffer, { startFrame: 100, endFrame: 140 }), [[130, 140]]);
	assert.deepEqual(findClipSilenceRegions(clip, buffer, { startFrame: 100, endFrame: 139 }), []);
});

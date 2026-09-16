/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { findTranslationCandidates } from '../src/common/editor/ui/community-translations/community-translation-picker.ts';

test('the picker retains ambiguous identities and identifies accessible attributes', () => {
	const candidates = findTranslationCandidates([
		{ text: 'Cancel', attribute: 'text' }, { text: 'Open the panel', attribute: 'aria-label' },
	], { cancel: 'Cancel', cancelJob: 'Cancel', openPanel: 'Open the panel' }, {});
	assert.deepEqual(candidates.map(({ key, attribute }) => [key, attribute]), [
		['cancel', 'text'], ['cancelJob', 'text'], ['openPanel', 'aria-label'],
	]);
});

test('the picker extracts template values without changing the message identity', () => {
	const candidates = findTranslationCandidates([{ text: 'Gain for Voice: 12 dB', attribute: 'title' }],
		{ gain: 'Gain for {track}: {value} dB', other: 'Gain' }, {});
	assert.equal(candidates.length, 1);
	assert.deepEqual(candidates[0], {
		key: 'gain', attribute: 'title', text: 'Gain for Voice: 12 dB', parameters: { track: 'Voice', value: '12' },
	});
});

test('the picker recognizes current translations and ignores absent source keys', () => {
	assert.deepEqual(findTranslationCandidates([{ text: 'Abbrechen', attribute: 'text' }],
		{ cancel: 'Cancel' }, { cancel: 'Abbrechen', old: 'Abbrechen' }).map(({ key }) => key), ['cancel']);
});

test('bare parameter wrappers do not claim unrelated clicked messages', () => {
	assert.deepEqual(findTranslationCandidates([{ text: 'Cancel', attribute: 'text' }],
		{ cancel: 'Cancel', notice: '{notice}', positions: '{left}/{right}' }, {}).map(({ key }) => key), ['cancel']);
});

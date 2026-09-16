/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { findTranslationCandidates } from '../src/common/editor/ui/community-translations/community-translation-picker.ts';
import { shortcutCategoryLabel, shortcutCategoryMessageKey } from '../src/common/editor/ui/dialogs/workspace-preferences-shortcut-categories.ts';

test('the clicked object identifies its message even when another key has identical text', () => {
	const candidates = findTranslationCandidates([{ text: 'Audio setup', attribute: 'text', messageKey: 'audioDevices' }],
		{ shortcutCategoryAudioSetup: 'Audio setup', audioDevices: 'Audio setup' }, {});
	assert.equal(candidates[0]?.key, 'audioDevices');
	assert.equal(candidates[0]?.isTarget, true);
	assert.equal(candidates.find(({ key }) => key === 'shortcutCategoryAudioSetup')?.isTarget, undefined);
});

test('object identity survives translated labels and text changed by other markup', () => {
	const candidates = findTranslationCandidates([{ text: 'Audio setup More', attribute: 'text', messageKey: 'audioDevices' }],
		{ audioDevices: 'Audio setup', shortcutCategoryAudioSetup: 'Audio setup' }, { audioDevices: 'Audiogeräte' });
	assert.equal(candidates[0]?.key, 'audioDevices');
	assert.equal(candidates[0]?.isTarget, true);
});

test('the identically labelled shortcut category keeps its own source identity', () => {
	const messageKey = shortcutCategoryMessageKey('Audio setup');
	const candidates = findTranslationCandidates([{ text: shortcutCategoryLabel('Audio setup', 'en'), attribute: 'text', messageKey }],
		{ audioDevices: 'Audio setup', shortcutCategoryAudioSetup: 'Audio setup' }, {});
	assert.equal(candidates[0]?.key, 'shortcutCategoryAudioSetup');
	assert.equal(candidates[0]?.isTarget, true);
	assert.equal(shortcutCategoryMessageKey(''), 'shortcutCategoryOther');
	assert.equal(shortcutCategoryMessageKey('shortcutCategoryOther'), 'shortcutCategoryOther');
	assert.equal(shortcutCategoryLabel('Unknown category', 'en'), 'Unknown category');
});

test('the identified object retains its interpolation parameters', () => {
	const candidates = findTranslationCandidates([{ text: 'Gain for Voice: 12 dB', attribute: 'title', messageKey: 'gain' }],
		{ gain: 'Gain for {track}: {value} dB', other: 'Gain for {track}: {value} dB' }, {});
	assert.equal(candidates[0]?.isTarget, true);
	assert.deepEqual(candidates[0]?.parameters, { track: 'Voice', value: '12' });
});

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

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { localizedValue } from '../src/common/i18n/locale.js';
import {
	formatPresentationMessage,
	freezePresentationMessage,
	publishLocalizedStatus,
	setLocalizedStatus,
	type LocalizedPresentationMessage,
} from '../src/common/i18n/presentation-message.ts';
import {
	acceptableTranslation,
	currentTranslations,
} from '../src/common/i18n/translation-catalog.js';

function catalog(entries: Record<string, unknown>): unknown {
	return { schemaVersion: 2, locale: 'fr', provenance: {}, entries };
}

test('localized values never read a locale string inherited from an attacker-controlled prototype', () => {
	const value = Object.assign(Object.create({ de: 'Geerbt' }) as Record<string, unknown>, {
		en: 'English',
	});
	assert.equal(localizedValue(value, 'de'), 'English');
});

test('localized values skip non-string exact matches instead of returning objects to UI callers', () => {
	assert.equal(localizedValue({ de: { text: 'not a string' }, en: 'English' }, 'de'), 'English');
});

test('presentation messages reject a cycle through a nested parameter with a named error', () => {
	const message: { key: string; parameters: Record<string, unknown> } = {
		key: 'outer',
		parameters: {},
	};
	message.parameters.inner = message;
	assert.throws(
		() => freezePresentationMessage(message as unknown as LocalizedPresentationMessage),
		/must not contain a cycle/u,
	);
});

test('presentation messages reject a cycle through appended messages with a named error', () => {
	const message: { key: string; append: unknown[] } = { key: 'outer', append: [] };
	message.append.push(message);
	assert.throws(
		() => freezePresentationMessage(message as unknown as LocalizedPresentationMessage),
		/must not contain a cycle/u,
	);
});

test('presentation messages refuse null and exotic nested parameter values before formatting', () => {
	assert.throws(
		() => freezePresentationMessage({ key: 'outer', parameters: { inner: null } } as never),
		/parameter inner is invalid/u,
	);
	assert.throws(
		() => freezePresentationMessage({ key: 'outer', parameters: { inner: new Date() } } as never),
		/parameter inner is invalid/u,
	);
});

test('presentation messages cap recursive nesting before formatter stack exhaustion', () => {
	let message: Record<string, unknown> = { key: 'leaf' };
	for (let index = 0; index < 33; index += 1) {
		message = { key: `level-${String(index)}`, parameters: { next: message } };
	}
	assert.throws(
		() => freezePresentationMessage(message as unknown as LocalizedPresentationMessage),
		/nested at most 32 levels/u,
	);
});

test('presentation messages require a real non-empty localization key', () => {
	assert.throws(() => freezePresentationMessage({ key: '' }), /non-empty string key/u);
	assert.throws(() => freezePresentationMessage({ key: 42 } as never), /non-empty string key/u);
});

test('formatting never resolves a copy template inherited through the catalog prototype', () => {
	const copy = Object.create({ notice: 'Inherited text' }) as object;
	assert.equal(formatPresentationMessage(copy, { key: 'notice', fallback: 'Owned fallback' }), 'Owned fallback');
});

test('setLocalizedStatus snapshots mutable parameters before a publisher retains them', () => {
	const parameters = { count: 3 };
	let retained: LocalizedPresentationMessage | undefined;
	setLocalizedStatus((_text, _state, localization) => { retained = localization; },
		{ count: '{count} results' }, 'count', parameters, 'success');
	parameters.count = 99;
	assert.equal(retained?.parameters?.count, 3);
	assert.equal(Object.isFrozen(retained?.parameters), true);
});

test('setLocalizedStatus snapshots appended nested messages before publication', () => {
	const nested = { key: 'done' };
	const append: (string | LocalizedPresentationMessage)[] = [' / ', nested];
	let retained: LocalizedPresentationMessage | undefined;
	setLocalizedStatus((_text, _state, localization) => { retained = localization; },
		{ ready: 'Ready', done: 'Done' }, 'ready', undefined, undefined, { append });
	nested.key = 'ready';
	append.push(' changed');
	assert.equal(formatPresentationMessage({ ready: 'Ready', done: 'Done' }, retained!), 'Ready / Done');
	assert.equal(Object.isFrozen(retained?.append), true);
});

test('publishLocalizedStatus does not expose its caller mutable localization descriptor', () => {
	const parameters = { count: 2 };
	const localization: LocalizedPresentationMessage = { key: 'count', parameters };
	let retained: LocalizedPresentationMessage | undefined;
	publishLocalizedStatus((_text, _state, descriptor) => { retained = descriptor; },
		'2 results', localization, 'success');
	parameters.count = 8;
	assert.notEqual(retained, localization);
	assert.equal(retained?.parameters?.count, 2);
});

test('translation catalogs ignore tuples with trailing unowned fields', () => {
	const translated = currentTranslations(catalog({
		open: ['machine', 'Open', 'Ouvrir', 'unowned'],
	}), { open: 'Open' });
	assert.deepEqual(translated, {});
});

test('translation origin filters must be arrays containing only recognized origin names', () => {
	const source = catalog({ open: ['machine', 'Open', 'Ouvrir'] });
	assert.throws(() => currentTranslations(source, { open: 'Open' }, { origins: 'machine' }), /origins must be an array/u);
	assert.throws(() => currentTranslations(source, { open: 'Open' }, { origins: ['vendor'] }), /recognized origins/u);
});

test('a translation must preserve every occurrence of a protected token', () => {
	assert.equal(acceptableTranslation('Compare .aup4 with .aup4', 'Comparer .aup4'), false);
});

test('translations may clarify a file extension but cannot introduce a formatter identifier', () => {
	assert.equal(acceptableTranslation('Cube LUT import', 'Import .cube LUT'), true);
	assert.equal(acceptableTranslation('Process track', 'Traiter *other_track*'), false);
});

test('uppercase file extensions receive the same protected-token custody as lowercase ones', () => {
	assert.equal(acceptableTranslation('Open .WAV', 'Ouvrir .WAV'), true);
	assert.equal(acceptableTranslation('Open .WAV', 'Ouvrir WAV'), false);
});

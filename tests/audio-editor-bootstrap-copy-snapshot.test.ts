/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { snapshotBootstrapCopyFields } from
	'../src/common/editor/ui/audio-editor-bootstrap-copy-snapshot.ts';
import FramescaperAudioEditorBootstrap from
	'../src/framescaper/ui/FramescaperAudioEditorBootstrap.tsx';
import SoundscaperAudioEditorBootstrap from
	'../src/soundscaper/ui/SoundscaperAudioEditorBootstrap.tsx';

test('bootstrap copy snapshot accepts exactly 4096 own fields without invoking getters', () => {
	const input = Object.fromEntries(Array.from({ length: 4_096 }, (_, index) => [
		`field${String(index)}`, index,
	]));
	const snapshot = snapshotBootstrapCopyFields(input, 'copy', 'own data property');
	assert.equal(Object.getPrototypeOf(snapshot), null);
	assert.equal(Object.isFrozen(snapshot), true);
	assert.equal(Reflect.ownKeys(snapshot).length, 4_096);
	assert.notEqual(snapshot, input);
	input.field0 = -1;
	assert.equal(snapshot.field0, 0);
	assert.throws(() => snapshotBootstrapCopyFields({
		...input, overflow: true,
	}, 'copy', 'own data property'), {
		name: 'RangeError', message: 'copy has an invalid field inventory.',
	});
});

test('bootstrap copy snapshot rejects symbols and accessor/non-enumerable fields without evaluation', () => {
	let getterCalls = 0;
	const accessor = Object.defineProperty({}, 'loading', {
		enumerable: true,
		get() { getterCalls += 1; return 'Wait'; },
	});
	assert.throws(() => snapshotBootstrapCopyFields(accessor, 'copy', 'own data property'), {
		name: 'TypeError', message: 'copy.loading must be an own data property.',
	});
	assert.equal(getterCalls, 0);
	assert.throws(() => snapshotBootstrapCopyFields(
		Object.defineProperty({}, 'loading', { value: 'Wait' }),
		'copy', 'own enumerable data property',
	), {
		name: 'TypeError', message: 'copy.loading must be an own enumerable data property.',
	});
	assert.throws(() => snapshotBootstrapCopyFields({ [Symbol('loading')]: 'Wait' },
		'copy', 'own data property'), {
		name: 'RangeError', message: 'copy has an invalid field inventory.',
	});
});

test('product fallback copy adapters retain their distinct property error wording', () => {
	const accessor = () => Object.defineProperty({}, 'loading', {
		enumerable: true, get: () => 'Wait',
	});
	assert.throws(() => renderToStaticMarkup(React.createElement(
		FramescaperAudioEditorBootstrap, { locale: 'en', fallbackCopy: accessor() },
	)), {
		name: 'TypeError',
		message: 'Framescaper fallback copy.loading must be an own data property.',
	});
	assert.throws(() => renderToStaticMarkup(React.createElement(
		SoundscaperAudioEditorBootstrap, { locale: 'en', fallbackCopy: accessor() },
	)), {
		name: 'TypeError',
		message: 'Soundscaper fallback copy.loading must be an own enumerable data property.',
	});
});

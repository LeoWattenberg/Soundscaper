/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { assertMotionLinkEditorIsolation } from './browser/helpers/motion-link-isolation.ts';

const headers = [
	{ name: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
	{ name: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
];
const available = { isolated: true, sharedArrayBuffer: 'function', secure: true };
const unavailable = { isolated: false, sharedArrayBuffer: 'undefined', secure: true };

test('Motion bridge editor admission follows independently observed isolation capability', () => {
	assert.doesNotThrow(() => assertMotionLinkEditorIsolation(headers, available, available));
	assert.doesNotThrow(() => assertMotionLinkEditorIsolation(headers, unavailable, unavailable));
});

test('Motion bridge editor admission refuses missing, relaxed, joined or duplicate opener policy even without host isolation', () => {
	for (const values of [[], ['unsafe-none'], ['same-origin-allow-popups'], ['same-origin, same-origin'], ['same-origin', 'same-origin']]) {
		const altered = [headers[1]!, ...values.map(value => ({ name: 'Cross-Origin-Opener-Policy', value }))];
		assert.throws(() => assertMotionLinkEditorIsolation(altered, unavailable, unavailable), /opener policy/u);
	}
});

test('Motion bridge editor admission refuses changed or missing embedder policy even without host isolation', () => {
	for (const values of [[], ['require-corp'], ['unsafe-none'], ['credentialless', 'credentialless']]) {
		const altered = [headers[0]!, ...values.map(value => ({ name: 'Cross-Origin-Embedder-Policy', value }))];
		assert.throws(() => assertMotionLinkEditorIsolation(altered, unavailable, unavailable), /embedder policy/u);
	}
});

test('Motion bridge editor admission refuses isolation or SharedArrayBuffer mismatches in either direction', () => {
	assert.throws(() => assertMotionLinkEditorIsolation(headers, unavailable, available), /isolation capability/u);
	assert.throws(() => assertMotionLinkEditorIsolation(headers, available, unavailable), /isolation capability/u);
	assert.throws(() => assertMotionLinkEditorIsolation(headers, { ...available, sharedArrayBuffer: 'undefined' }, available), /SharedArrayBuffer/u);
	assert.throws(() => assertMotionLinkEditorIsolation(headers, { ...unavailable, sharedArrayBuffer: 'function' }, unavailable), /SharedArrayBuffer/u);
});

test('Motion bridge editor admission refuses insecure pages and inconsistent independent witnesses', () => {
	assert.throws(() => assertMotionLinkEditorIsolation(headers, { ...available, secure: false }, available), /secure context/u);
	assert.throws(() => assertMotionLinkEditorIsolation(headers, unavailable, { ...unavailable, secure: false }), /probe secure context/u);
	assert.throws(() => assertMotionLinkEditorIsolation(headers, available, { ...available, sharedArrayBuffer: 'undefined' }), /probe SharedArrayBuffer/u);
});

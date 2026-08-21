/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	admitFramescaperWebVcrUrl,
	cancelFramescaperWebVcrDownload,
	framescaperWebVcrPermissionAllowed,
	validateFramescaperWebVcrInput,
	webVcrPopupAllowed,
} from '../desktop/framescaper-web-vcr-security-policy.ts';

test('navigation admits canonical HTTPS and the exact internal blank document only', () => {
	assert.equal(admitFramescaperWebVcrUrl('https://example.com/watch').url, 'https://example.com/watch');
	assert.equal(admitFramescaperWebVcrUrl('about:blank').url, 'about:blank');
	for (const value of [
		'http://example.com/',
		'file:///etc/passwd',
		'javascript:alert(1)',
		'about:blank#remote',
		'https://user:secret@example.com/',
		'https://example.com/\nnext',
	]) {
		assert.throws(() => admitFramescaperWebVcrUrl(value), /url|https|credential|control/iu, value);
	}
});

test('remote permissions and downloads are denied without exceptions', () => {
	for (const permission of [
		'camera', 'microphone', 'media', 'display-capture', 'geolocation', 'notifications',
		'midi', 'midiSysex', 'usb', 'serial', 'bluetooth', 'fullscreen', 'clipboard-read',
	]) assert.equal(framescaperWebVcrPermissionAllowed(permission), false);
	const event = { prevented: 0, preventDefault() { this.prevented += 1; } };
	const item = { cancelled: 0, cancel() { this.cancelled += 1; } };
	cancelFramescaperWebVcrDownload(event, item);
	assert.deepEqual({ prevented: event.prevented, cancelled: item.cancelled }, { prevented: 1, cancelled: 1 });
});

test('popup admission is HTTPS-only, idle-only, and bounded to four', () => {
	assert.equal(webVcrPopupAllowed({ url: 'https://login.example.com/', phase: 'ready', openPopupCount: 3 }), true);
	assert.equal(webVcrPopupAllowed({ url: 'https://login.example.com/', phase: 'ready', openPopupCount: 4 }), false);
	assert.equal(webVcrPopupAllowed({ url: 'https://login.example.com/', phase: 'recording', openPopupCount: 0 }), false);
	assert.equal(webVcrPopupAllowed({ url: 'http://login.example.com/', phase: 'ready', openPopupCount: 0 }), false);
});

test('input validation accepts a closed bounded vocabulary only', () => {
	assert.deepEqual(validateFramescaperWebVcrInput({
		kind: 'wheel', x: 0.5, y: 0.5, deltaX: -12, deltaY: 120,
	}), { kind: 'wheel', x: 0.5, y: 0.5, deltaX: -12, deltaY: 120 });
	assert.deepEqual(validateFramescaperWebVcrInput({
		kind: 'key', event: 'down', keyCode: 'Enter', modifiers: ['shift', 'control'],
	}), { kind: 'key', event: 'down', keyCode: 'Enter', modifiers: ['shift', 'control'] });
	assert.throws(() => validateFramescaperWebVcrInput({
		kind: 'wheel', x: 0.5, y: 0.5, deltaX: 0, deltaY: 4097,
	}), /wheel/iu);
	assert.throws(() => validateFramescaperWebVcrInput({
		kind: 'key', event: 'down', keyCode: 'x'.repeat(33), modifiers: [],
	}), /key/iu);
	assert.throws(() => validateFramescaperWebVcrInput({
		kind: 'key', event: 'down', keyCode: 'Enter', modifiers: ['shift', 'shift'],
	}), /modifier/iu);
	assert.throws(() => validateFramescaperWebVcrInput({
		kind: 'key', event: 'down', keyCode: 'Enter', modifiers: [], nativeCode: 13,
	}), /unsupported fields/iu);
});

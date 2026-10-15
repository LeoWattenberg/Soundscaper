/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { observeNativeDraftSelection } from '../src/common/editor/ui/inspector/native-draft-selection.ts';

class Field extends EventTarget {
	disabled = false;
	readOnly = false;
	selectionStart: number | null = null;
	selectionEnd: number | null = null;
	listener: EventListener | null = null;
	added = 0;
	removed = 0;
	override addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean): void {
		super.addEventListener(type, listener, options);
		if (type === 'select') {
			assert.equal(typeof listener, 'function');
			this.listener = listener as EventListener;
			this.added++;
		}
	}
	override removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean): void {
		super.removeEventListener(type, listener, options);
		if (type === 'select') this.removed++;
	}
}

test('native number selection reserves replacement without a keydown or text commit', () => {
	const field = new Field();
	let reserved = 0;
	const release = observeNativeDraftSelection(field, () => { reserved++; });
	try {
		const selected = new Event('select', { cancelable: true });
		assert.equal(field.dispatchEvent(selected), true);
		assert.equal(selected.defaultPrevented, false, 'native selection remains untouched');
		assert.equal(reserved, 1);
	} finally { release(); }
});

test('focus, keyboard and input events alone do not reserve through the native-selection observer', () => {
	const field = new Field();
	let reserved = 0;
	const release = observeNativeDraftSelection(field, () => { reserved++; });
	try {
		for (const type of ['focus', 'focusin', 'keydown', 'beforeinput', 'input', 'blur']) field.dispatchEvent(new Event(type));
		assert.equal(reserved, 0);
	} finally { release(); }
});

for (const blocked of ['disabled', 'readOnly'] as const) {
	test(`native selection respects the field's live ${blocked} state`, () => {
		const field = new Field();
		let reserved = 0;
		const release = observeNativeDraftSelection(field, () => { reserved++; });
		try {
			field[blocked] = true;
			field.dispatchEvent(new Event('select'));
			assert.equal(reserved, 0);
			field[blocked] = false;
			field.dispatchEvent(new Event('select'));
			assert.equal(reserved, 1);
		} finally { release(); }
	});
}

test('a selection belonging to another field cannot reserve this field', () => {
	const field = new Field(), other = new Field();
	let reserved = 0;
	const release = observeNativeDraftSelection(field, () => { reserved++; });
	try {
		const callback = field.listener;
		assert.ok(callback);
		other.addEventListener('select', event => callback(event));
		other.dispatchEvent(new Event('select'));
		assert.equal(reserved, 0);
		field.dispatchEvent(new Event('select'));
		assert.equal(reserved, 1);
	} finally { release(); }
});

test('collapsed text selection is not replacement intent, while an actual range is', () => {
	const field = new Field();
	field.selectionStart = field.selectionEnd = 0;
	let reserved = 0;
	const release = observeNativeDraftSelection(field, () => { reserved++; });
	try {
		field.dispatchEvent(new Event('select'));
		assert.equal(reserved, 0);
		field.selectionEnd = 1;
		field.dispatchEvent(new Event('select'));
		assert.equal(reserved, 1);
	} finally { release(); }
});

test('release removes its exact listener and retires a queued callback before a new owner mounts', () => {
	const field = new Field();
	let first = 0, second = 0;
	const release = observeNativeDraftSelection(field, () => { first++; });
	const stale = field.listener;
	assert.ok(stale);
	assert.equal(field.added, 1);
	release();
	assert.equal(field.removed, 1);
	const releaseNext = observeNativeDraftSelection(field, () => { second++; });
	try {
		field.addEventListener('select', event => stale(event));
		field.dispatchEvent(new Event('select'));
		assert.equal(first, 0);
		assert.equal(second, 1);
	} finally { releaseNext(); }
});

test('absent fields and fields without draft ownership acquire no listener', () => {
	observeNativeDraftSelection(null, () => undefined)();
	const field = new Field();
	observeNativeDraftSelection(field, undefined)();
	assert.equal(field.added, 0);
});

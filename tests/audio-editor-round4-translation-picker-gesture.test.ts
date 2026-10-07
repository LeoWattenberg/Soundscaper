/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { retainCommunityTranslationPicker } from '../src/common/editor/ui/community-translations/community-translation-picker.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

test('a translation pick suppresses outside pointer and mouse starts until the identifying click', () => {
	const dom = installReactTestDom();
	const target = new CaptureTarget();
	const panel = document.createElement('section');
	const slider = document.createElement('input');
	let starts = 0;
	let picks = 0;
	const release = retainCommunityTranslationPicker(target, { current: panel }, () => { picks += 1; }, () => undefined);
	const start = () => { starts += 1; };
	target.addEventListener('pointerdown', start);
	target.addEventListener('mousedown', start);
	try {
		for (const type of ['pointerdown', 'mousedown']) {
			const event = controlEvent(type, slider);
			target.dispatchEvent(event);
			assert.equal(event.defaultPrevented, true, `${type} cannot start native or editor audio changes`);
		}
		assert.equal(starts, 0);
		assert.equal(picks, 0, 'gesture suppression keeps the identifying click owned');
		target.dispatchEvent(controlEvent('click', slider));
		assert.equal(picks, 1);
		const ownInput = document.createElement('input');
		panel.appendChild(ownInput);
		const inside = controlEvent('pointerdown', ownInput);
		target.dispatchEvent(inside);
		assert.equal(inside.defaultPrevented, false);
		assert.equal(starts, 1, 'the translation editor retains its own controls');
		release();
		target.dispatchEvent(controlEvent('pointerdown', slider));
		target.dispatchEvent(controlEvent('mousedown', slider));
		target.dispatchEvent(controlEvent('click', slider));
		assert.equal(starts, 3, 'ordinary control gestures resume after leaving picking');
		assert.equal(picks, 1, 'identification listeners are released together');
	} finally {
		release();
		dom.restore();
	}
});

function controlEvent(type: string, control: HTMLElement): Event {
	const event = new Event(type, { cancelable: true });
	Object.defineProperty(event, 'target', { value: control });
	return event;
}

// Node's EventTarget ignores boolean capture during removal; use the equivalent
// options objects so the lifecycle exercises browser capture semantics.
class CaptureTarget extends EventTarget {
	override addEventListener(type: string, listener: EventListenerOrEventListenerObject | null,
		options?: boolean | AddEventListenerOptions): void {
		super.addEventListener(type, listener, typeof options === 'boolean' ? { capture: options } : options);
	}
	override removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null,
		options?: boolean | EventListenerOptions): void {
		super.removeEventListener(type, listener, typeof options === 'boolean' ? { capture: options } : options);
	}
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { retainNativeRangeTouchOwner } from '../src/common/editor/ui/useNativeRangeTouchOwner.ts';

function touch(target: EventTarget, type: string, changed: readonly number[], active: readonly number[]): boolean {
	const event = new Event(type, { cancelable: true });
	Object.assign(event, { changedTouches: changed.map(identifier => ({ identifier })),
		touches: active.map(identifier => ({ identifier })) });
	target.dispatchEvent(event);
	return event.defaultPrevented;
}

for (const ending of ['touchend', 'touchcancel']) test(`foreign ${ending} leaves the first native range drag active`, () => {
	const input = new EventTarget();
	const release = retainNativeRangeTouchOwner(input as HTMLInputElement);
	try {
		assert.equal(touch(input, 'touchstart', [17], [17]), false, 'the first finger retains the browser default');
		assert.equal(touch(input, 'touchmove', [17], [17]), false);
		assert.equal(touch(input, 'touchstart', [42], [17, 42]), true, 'the second finger cannot begin a new native range drag');
		assert.equal(touch(input, ending, [42], [17]), true, 'the second finger cannot finish the browser native range drag');
		assert.equal(touch(input, 'touchmove', [17], [17]), false);
		assert.equal(touch(input, 'touchend', [17], []), false, 'the first finger completes normally');
		assert.equal(touch(input, 'touchstart', [59], [59]), false, 'a later finger starts normally');
		assert.equal(touch(input, 'touchend', [59], []), false);
	} finally { release(); }
	assert.equal(touch(input, 'touchstart', [17], [17]), false);
	assert.equal(touch(input, 'touchstart', [42], [17, 42]), false, 'unmount removes every interceptor');
});

test('an already secondary finger cannot begin native range interaction', () => {
	const input = new EventTarget();
	const release = retainNativeRangeTouchOwner(input as HTMLInputElement);
	try {
		assert.equal(touch(input, 'touchstart', [42], [17, 42]), true);
		assert.equal(touch(input, 'touchend', [42], [17]), true);
		assert.equal(touch(input, 'touchstart', [59], [59]), false);
		assert.equal(touch(input, 'touchend', [59], []), false);
	} finally { release(); }
});

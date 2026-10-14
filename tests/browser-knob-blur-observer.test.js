/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { installKnobWindowBlurObserver } from './browser/helpers/knob-window-blur-observer.js';

function fixture() {
	const window = new EventTarget();
	let pointerDown;
	window.document = { addEventListener: (type, listener) => { if (type === 'pointerdown') pointerDown = listener; } };
	let caller = 'knob-effect';
	const probe = installKnobWindowBlurObserver(window, () => caller);
	const owner = { dragging: false, captured: false,
		matches: selector => selector === '.knob' || owner.dragging,
		hasPointerCapture: pointerId => owner.captured && pointerId === 7,
		closest: () => owner };
	const begin = () => {
		probe.arm(owner);
		pointerDown({ target: owner, pointerId: 7, button: 0, isPrimary: true });
		owner.dragging = true;
		owner.captured = true;
	};
	const end = () => { owner.dragging = false; owner.captured = false; };
	return { window, probe, owner, begin, end, caller: value => { caller = value; } };
}

test('only the learned captured-knob listener makes its next gesture ready', () => {
	const f = fixture();
	function knobBlur() {}
	function unrelatedBlur() {}
	f.begin();
	f.window.addEventListener('blur', knobBlur);
	f.caller('unrelated-effect');
	f.window.addEventListener('blur', unrelatedBlur);
	f.end();
	f.window.removeEventListener('blur', knobBlur);
	assert.equal(f.probe.candidateCount(), 1);
	f.probe.learn();
	f.begin();
	f.window.addEventListener('blur', unrelatedBlur);
	assert.equal(f.probe.ready(), false, 'an unrelated or already registered listener cannot satisfy readiness');
	f.caller('different-owner');
	f.window.addEventListener('blur', knobBlur);
	assert.equal(f.probe.ready(), false, 'the same callback text at another call site is insufficient');
	f.window.removeEventListener('blur', knobBlur);
	f.caller('knob-effect');
	f.window.addEventListener('blur', knobBlur);
	assert.equal(f.probe.ready(), true);
	f.owner.captured = false;
	assert.equal(f.probe.ready(), false, 'the learned listener must belong to a captured active gesture');
});

test('ambiguous ended listeners refuse calibration instead of choosing another owner', () => {
	const f = fixture();
	f.begin();
	const first = () => undefined;
	const other = () => undefined;
	f.window.addEventListener('blur', first);
	f.caller('other-effect');
	f.window.addEventListener('blur', other);
	f.end();
	f.window.removeEventListener('blur', first);
	f.window.removeEventListener('blur', other);
	assert.equal(f.probe.candidateCount(), 2);
	assert.throws(() => f.probe.learn(), /one ended knob listener/u);
});

test('a preexisting native registration cannot be attributed to a later duplicate add', () => {
	const f = fixture();
	const listener = () => undefined;
	f.window.addEventListener('blur', listener);
	f.begin();
	f.window.addEventListener('blur', listener);
	f.end();
	f.window.removeEventListener('blur', listener);
	assert.equal(f.probe.candidateCount(), 0);
	assert.throws(() => f.probe.learn(), /one ended knob listener/u);
});

test('observing keeps native callback identity, duplicate registration, removal and options behavior', () => {
	const f = fixture();
	let calls = 0;
	const listener = () => { calls += 1; };
	f.begin();
	f.window.addEventListener('blur', listener);
	f.window.addEventListener('blur', listener, false);
	f.window.dispatchEvent(new Event('blur'));
	assert.equal(calls, 1);
	f.window.removeEventListener('blur', listener, false);
	f.window.dispatchEvent(new Event('blur'));
	assert.equal(calls, 1);
	let optionReads = 0;
	const options = { once: true, get capture() { optionReads += 1; return false; } };
	f.window.addEventListener('blur', listener, options);
	assert.equal(optionReads, 1, 'the observer must not reread native options getters');
	f.window.dispatchEvent(new Event('blur'));
	f.window.dispatchEvent(new Event('blur'));
	assert.equal(calls, 2);
	assert.equal(f.probe.candidateCount(), 0);
});

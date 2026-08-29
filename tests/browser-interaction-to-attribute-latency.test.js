/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	armInteractionToAttributeLatencyProbe,
	readInteractionToAttributeLatencyProbe,
} from './browser/helpers/interaction-to-attribute-latency.js';

class FakeElement {
	attributes = new Map();
	listeners = new Map();

	addEventListener(type, listener) {
		this.listeners.set(type, listener);
	}

	removeEventListener(type, listener) {
		if (this.listeners.get(type) === listener) this.listeners.delete(type);
	}

	getAttribute(name) {
		return this.attributes.get(name) ?? null;
	}

	dispatch(type) {
		this.listeners.get(type)?.();
	}
}

test('the latency probe measures renderer interaction-to-attribute publication', async (context) => {
	const observers = [];
	const previous = globalThis.MutationObserver;
	class FakeMutationObserver {
		constructor(callback) {
			this.callback = callback;
			observers.push(this);
		}

		observe() {}
		disconnect() {}
		publish(attributeName) {
			this.callback([{ type: 'attributes', attributeName }]);
		}
	}
	globalThis.MutationObserver = FakeMutationObserver;
	context.after(() => { globalThis.MutationObserver = previous; });
	const actionTarget = new FakeElement();
	const observedTarget = new FakeElement();
	observedTarget.attributes.set('aria-valuenow', '0');

	const probeId = armInteractionToAttributeLatencyProbe({
		actionTarget,
		observedTarget,
		eventType: 'pointerdown',
		attributeName: 'aria-valuenow',
		expectedValue: '2880000',
	});
	actionTarget.dispatch('pointerdown');
	observedTarget.attributes.set('aria-valuenow', '2880000');
	observers[0].publish('aria-valuenow');

	const elapsedMs = await readInteractionToAttributeLatencyProbe({
		observedTarget,
		probeId,
		timeoutMs: 100,
	});
	assert.equal(typeof elapsedMs, 'number');
	assert.ok(elapsedMs >= 0);
	assert.equal(actionTarget.listeners.has('pointerdown'), false);
});

test('a state mutation before the measured interaction does not start the clock', async (context) => {
	const observers = [];
	const previous = globalThis.MutationObserver;
	class FakeMutationObserver {
		constructor(callback) {
			this.callback = callback;
			observers.push(this);
		}

		observe() {}
		disconnect() {}
		publish(attributeName) {
			this.callback([{ type: 'attributes', attributeName }]);
		}
	}
	globalThis.MutationObserver = FakeMutationObserver;
	context.after(() => { globalThis.MutationObserver = previous; });
	const actionTarget = new FakeElement();
	const observedTarget = new FakeElement();
	observedTarget.attributes.set('aria-valuenow', '0');
	const probeId = armInteractionToAttributeLatencyProbe({
		actionTarget,
		observedTarget,
		eventType: 'keydown',
		attributeName: 'aria-valuenow',
		expectedValue: '0',
	});
	observers[0].publish('aria-valuenow');
	const reading = readInteractionToAttributeLatencyProbe({
		observedTarget,
		probeId,
		timeoutMs: 100,
	});
	actionTarget.dispatch('keydown');

	assert.equal(typeof await reading, 'number');
});

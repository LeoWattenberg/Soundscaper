/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	applicationInstallPromptCapture,
	createInstallPromptCapture,
	resetApplicationInstallPromptCapture,
	type InstallPromptEventSource,
} from '../src/common/offline/install-prompt.ts';

type Listener = (event: unknown) => void;

function fakeSource() {
	const listeners = new Map<string, Set<Listener>>();
	const source: InstallPromptEventSource = {
		addEventListener(type, listener) {
			const bucket = listeners.get(type) ?? new Set<Listener>();
			bucket.add(listener);
			listeners.set(type, bucket);
		},
		removeEventListener(type, listener) {
			listeners.get(type)?.delete(listener);
		},
	};
	return {
		source,
		listenerCount: (type: string) => listeners.get(type)?.size ?? 0,
		dispatch(type: string, event: unknown = {}) {
			for (const listener of [...(listeners.get(type) ?? [])]) listener(event);
		},
	};
}

function fakeOffer(outcome = 'accepted') {
	const calls = { prevented: 0, prompted: 0 };
	return {
		calls,
		event: {
			preventDefault() { calls.prevented += 1; },
			prompt() { calls.prompted += 1; return Promise.resolve(); },
			userChoice: Promise.resolve({ outcome }),
		},
	};
}

test('no install prompt is available before the browser has offered one', async () => {
	const target = fakeSource();
	const capture = createInstallPromptCapture({ source: target.source });
	assert.equal(capture.available(), false);
	assert.equal(await capture.prompt(), 'unavailable');
});

test('capturing the browser offer suppresses the built-in bar and holds the prompt', () => {
	const target = fakeSource();
	const announced: boolean[] = [];
	const capture = createInstallPromptCapture({
		source: target.source,
		onChange: (available) => announced.push(available),
	});
	const offer = fakeOffer();
	target.dispatch('beforeinstallprompt', offer.event);
	assert.equal(offer.calls.prevented, 1);
	assert.equal(capture.available(), true);
	assert.deepEqual(announced, [true]);
});

test('replaying the offer prompts once and spends it so a second choice finds nothing', async () => {
	const target = fakeSource();
	const capture = createInstallPromptCapture({ source: target.source });
	const offer = fakeOffer();
	target.dispatch('beforeinstallprompt', offer.event);
	assert.equal(await capture.prompt(), 'accepted');
	assert.equal(offer.calls.prompted, 1);
	assert.equal(capture.available(), false);
	assert.equal(await capture.prompt(), 'unavailable');
	assert.equal(offer.calls.prompted, 1);
});

test('a browser choice against installing is reported as a dismissal', async () => {
	const target = fakeSource();
	const capture = createInstallPromptCapture({ source: target.source });
	target.dispatch('beforeinstallprompt', fakeOffer('dismissed').event);
	assert.equal(await capture.prompt(), 'dismissed');
});

test('an offer without a browser choice is reported as a dismissal rather than failing', async () => {
	const target = fakeSource();
	const capture = createInstallPromptCapture({ source: target.source });
	let prompted = 0;
	target.dispatch('beforeinstallprompt', {
		preventDefault: () => undefined,
		prompt: () => { prompted += 1; },
	});
	assert.equal(await capture.prompt(), 'dismissed');
	assert.equal(prompted, 1);
});

test('an installed application discards the captured offer', () => {
	const target = fakeSource();
	const announced: boolean[] = [];
	const capture = createInstallPromptCapture({
		source: target.source,
		onChange: (available) => announced.push(available),
	});
	target.dispatch('beforeinstallprompt', fakeOffer().event);
	target.dispatch('appinstalled');
	assert.equal(capture.available(), false);
	assert.deepEqual(announced, [true, false]);
});

test('an event that carries no prompt is ignored rather than captured', () => {
	const target = fakeSource();
	const capture = createInstallPromptCapture({ source: target.source });
	target.dispatch('beforeinstallprompt', { preventDefault: () => undefined });
	target.dispatch('beforeinstallprompt', null);
	assert.equal(capture.available(), false);
});

test('stopping the capture detaches both listeners and drops the held offer', () => {
	const target = fakeSource();
	const capture = createInstallPromptCapture({ source: target.source });
	target.dispatch('beforeinstallprompt', fakeOffer().event);
	assert.equal(target.listenerCount('beforeinstallprompt'), 1);
	assert.equal(target.listenerCount('appinstalled'), 1);
	capture.stop();
	assert.equal(capture.available(), false);
	assert.equal(target.listenerCount('beforeinstallprompt'), 0);
	assert.equal(target.listenerCount('appinstalled'), 0);
});

test('a host without an event target yields a capture that is permanently unavailable', async () => {
	const capture = createInstallPromptCapture({ source: null });
	assert.equal(capture.available(), false);
	assert.equal(await capture.prompt(), 'unavailable');
	capture.stop();
});

test('the editor shares one capture and builds a fresh one only after a reset', () => {
	const capture = applicationInstallPromptCapture();
	try {
		assert.equal(applicationInstallPromptCapture(), capture, 'the shared capture is built once');
		// Node publishes no window event target, so the shared capture binds to
		// nothing here instead of failing; a browser host gives it the two listeners.
		assert.equal(capture.available(), false);
	} finally {
		resetApplicationInstallPromptCapture();
	}
	const replacement = applicationInstallPromptCapture();
	try {
		assert.notEqual(replacement, capture, 'a reset capture is replaced rather than revived');
	} finally {
		resetApplicationInstallPromptCapture();
	}
});

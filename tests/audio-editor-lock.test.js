import test from 'node:test';
import assert from 'node:assert/strict';

import { acquireProjectLock } from '../src/common/editor/project-lock.js';

test('project lock holds and releases a navigator lock', async () => {
	let callback;
	const locks = {
		request(_name, options, next) {
			assert.equal(options.ifAvailable, true);
			callback = next;
			return next({ name: 'project' });
		},
	};
	const lock = await acquireProjectLock('one', { navigator: { locks } });
	assert.equal(typeof callback, 'function');
	assert.equal(lock.readOnly, false);
	lock.release();
	await lock.finished;
});

test('project lock allows an in-flight navigator lock release to complete before becoming read-only', async () => {
	let requests = 0;
	const locks = {
		request(_name, _options, next) {
			requests += 1;
			return next(requests === 1 ? null : { name: 'project' });
		},
	};
	const lock = await acquireProjectLock('handoff', {
		navigator: { locks },
		navigatorLockHandoffMs: 0,
	});
	assert.equal(requests, 2);
	assert.equal(lock.readOnly, false);
	lock.release();
	await lock.finished;
});

test('project lease makes a second writer read-only and releases ownership', async () => {
	const values = new Map();
	const storage = {
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => values.set(key, value),
		removeItem: (key) => values.delete(key),
	};
	const first = await acquireProjectLock('two', {
		navigator: {}, localStorage: storage, BroadcastChannel: null,
		setInterval: () => 1, clearInterval: () => {}, now: () => 100,
	});
	const second = await acquireProjectLock('two', {
		navigator: {}, localStorage: storage, BroadcastChannel: null,
		setInterval: () => 2, clearInterval: () => {}, now: () => 101,
	});
	assert.equal(first.readOnly, false);
	assert.equal(second.readOnly, true);
	first.release();
	const third = await acquireProjectLock('two', {
		navigator: {}, localStorage: storage, BroadcastChannel: null,
		setInterval: () => 3, clearInterval: () => {}, now: () => 102,
	});
	assert.equal(third.readOnly, false);
	third.release();
});

test('an expired project lease is reclaimed without letting its former owner remove the replacement', async () => {
	const values = new Map();
	const storage = {
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => values.set(key, value),
		removeItem: (key) => values.delete(key),
	};
	const abandoned = await acquireProjectLock('stale', {
		navigator: {}, localStorage: storage, BroadcastChannel: null,
		setInterval: () => 1, clearInterval: () => {}, now: () => 100,
	});
	const replacement = await acquireProjectLock('stale', {
		navigator: {}, localStorage: storage, BroadcastChannel: null,
		setInterval: () => 2, clearInterval: () => {}, now: () => 15_101,
	});
	assert.equal(replacement.readOnly, false);
	abandoned.release();
	const contender = await acquireProjectLock('stale', {
		navigator: {}, localStorage: storage, BroadcastChannel: null,
		setInterval: () => 3, clearInterval: () => {}, now: () => 15_102,
	});
	assert.equal(contender.readOnly, true);
	replacement.release();
});

test('a page lifecycle exit releases a fallback lease synchronously', async () => {
	const values = new Map();
	const listeners = new Map();
	const storage = {
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => values.set(key, value),
		removeItem: (key) => values.delete(key),
	};
	const lifecycleTarget = {
		addEventListener: (type, listener) => listeners.set(type, listener),
		removeEventListener: (type, listener) => {
			if (listeners.get(type) === listener) listeners.delete(type);
		},
	};
	await acquireProjectLock('page-exit', {
		navigator: {}, localStorage: storage, BroadcastChannel: null, lifecycleTarget,
		setInterval: () => 1, clearInterval: () => {}, now: () => 100,
	});
	assert.equal(values.size, 1);
	listeners.get('pagehide')();
	assert.equal(values.size, 0);
	assert.equal(listeners.has('pagehide'), false);
});

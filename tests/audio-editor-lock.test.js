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

test('an unavailable navigator lock exposes its queued ownership handoff', async () => {
	let grant;
	const locks = {
		request(_name, options, next) {
			if (options.ifAvailable) return next(null);
			return new Promise((resolve) => {
				grant = () => Promise.resolve(next({ name: 'project' })).then(resolve);
			});
		},
	};
	const lock = await acquireProjectLock('queued', {
		navigator: { locks },
		navigatorLockHandoffMs: 0,
	});
	assert.equal(lock.readOnly, true);
	assert.equal(typeof grant, 'function');
	const granted = grant();
	const available = await lock.available;
	assert.notStrictEqual(available, lock);
	assert.equal(lock.readOnly, true);
	assert.equal(available.readOnly, false);
	available.release();
	await Promise.all([lock.finished, granted]);
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

test('project lease probes the owner before reclaiming a live or abandoned lease', async () => {
	const values = new Map();
	const channels = new Map();
	const storage = {
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => values.set(key, value),
		removeItem: (key) => values.delete(key),
	};
	class FakeBroadcastChannel {
		constructor(name) {
			this.name = name;
			const peers = channels.get(name) ?? new Set();
			peers.add(this);
			channels.set(name, peers);
		}

		postMessage(data) {
			for (const peer of [...channels.get(this.name)]) {
				if (peer !== this) peer.onmessage?.({ data });
			}
		}

		close() {
			channels.get(this.name)?.delete(this);
		}
	}
	const immediateTimeout = (callback) => {
		callback();
		return 1;
	};
	const first = await acquireProjectLock('live-owner', {
		navigator: {}, localStorage: storage, BroadcastChannel: FakeBroadcastChannel,
		setInterval: () => 1, clearInterval: () => {}, setTimeout: immediateTimeout, now: () => 100,
	});
	const contender = await acquireProjectLock('live-owner', {
		navigator: {}, localStorage: storage, BroadcastChannel: FakeBroadcastChannel,
		setInterval: () => 2, clearInterval: () => {}, setTimeout: immediateTimeout, now: () => 101,
	});
	assert.equal(first.readOnly, false);
	assert.equal(contender.readOnly, true);
	first.release();

	const abandoned = await acquireProjectLock('abandoned-owner', {
		navigator: {}, localStorage: storage, BroadcastChannel: null,
		setInterval: () => 3, clearInterval: () => {}, now: () => 100,
	});
	const replacement = await acquireProjectLock('abandoned-owner', {
		navigator: {}, localStorage: storage, BroadcastChannel: FakeBroadcastChannel,
		setInterval: () => 4, clearInterval: () => {}, setTimeout: immediateTimeout, now: () => 101,
	});
	assert.equal(abandoned.readOnly, false);
	assert.equal(replacement.readOnly, false);
	abandoned.release();
	const nextContender = await acquireProjectLock('abandoned-owner', {
		navigator: {}, localStorage: storage, BroadcastChannel: FakeBroadcastChannel,
		setInterval: () => 5, clearInterval: () => {}, setTimeout: immediateTimeout, now: () => 102,
	});
	assert.equal(nextContender.readOnly, true);
	replacement.release();

	const legacyOwner = await acquireProjectLock('legacy-owner', {
		navigator: {}, localStorage: storage, BroadcastChannel: null,
		setInterval: () => 6, clearInterval: () => {}, now: () => 100,
	});
	const [legacyKey] = [...values.keys()];
	const legacyLease = JSON.parse(values.get(legacyKey));
	delete legacyLease.protocol;
	values.set(legacyKey, JSON.stringify(legacyLease));
	const legacyContender = await acquireProjectLock('legacy-owner', {
		navigator: {}, localStorage: storage, BroadcastChannel: FakeBroadcastChannel,
		setInterval: () => 7, clearInterval: () => {}, setTimeout: immediateTimeout, now: () => 101,
	});
	assert.equal(legacyContender.readOnly, true);
	legacyOwner.release();
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

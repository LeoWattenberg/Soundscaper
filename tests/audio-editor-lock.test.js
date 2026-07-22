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

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { runBoundedSmokeChild } from '../scripts/lib/desktop-smoke-child.mjs';

const options = {
	cwd: '/admitted', environment: { ADMITTED: 'yes' },
	outputLimit: 8, timeout: 20, label: 'test', errorEvent: 'once',
};

function childFixture() {
	const child = new EventEmitter();
	child.pid = 123;
	child.stdout = new PassThrough();
	child.stderr = new PassThrough();
	child.unref = () => { child.abandoned = true; };
	child.kill = (signal) => { child.fallbackSignal = signal; };
	return child;
}

test('smoke child keeps on/once error policy and settles only once', async () => {
	for (const errorEvent of ['on', 'once']) {
		const child = childFixture();
		const failure = new Error('spawn failed');
		const promise = runBoundedSmokeChild('command', [], { ...options, errorEvent }, {
			spawnChild: (_command, _args, spawnOptions) => {
				assert.deepEqual(spawnOptions, {
					cwd: '/admitted', detached: true, env: { ADMITTED: 'yes' },
					stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
				});
				return child;
			},
			platform: 'linux',
		});
		const rejected = assert.rejects(promise, (error) => error === failure);
		child.emit('error', failure);
		child.emit('close', 1, null);
		await rejected;
		assert.equal(child.listenerCount('error'), errorEvent === 'on' ? 1 : 0);
	}
});

test('smoke child kills surviving descendants after the parent closes', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const child = childFixture();
	const signals = [];
	const promise = runBoundedSmokeChild('command', [], options, {
		spawnChild: () => child, platform: 'linux',
		killGroup: (pid, signal) => { signals.push([pid, signal]); },
	});
	let settled = false;
	const rejected = assert.rejects(promise, { message: 'Packaged test child timed out after 20 milliseconds' })
		.then(() => { settled = true; });
	t.mock.timers.tick(20);
	child.emit('close', 0, null);
	await Promise.resolve();
	assert.equal(settled, false);
	assert.deepEqual(signals, [[-123, 'SIGTERM']]);
	t.mock.timers.tick(250);
	await rejected;
	assert.deepEqual(signals, [[-123, 'SIGTERM'], [-123, 'SIGKILL']]);
	assert.equal(child.abandoned, undefined);
});

test('smoke child bounds failed tree termination with independent abandonment', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const child = childFixture();
	const fallbackSignals = [];
	child.kill = (signal) => { fallbackSignals.push(signal); throw new Error('kill failed'); };
	const promise = runBoundedSmokeChild('command', [], options, {
		spawnChild: () => child, platform: 'linux',
		killGroup: () => { throw Object.assign(new Error('denied'), { code: 'EPERM' }); },
	});
	const rejected = assert.rejects(promise, { message: 'Packaged test child output exceeds 8 bytes' });
	child.stdout.write('12345');
	child.stderr.write('6789');
	child.stdout.write('ignored');
	t.mock.timers.tick(1_000);
	await rejected;
	assert.deepEqual(fallbackSignals, ['SIGTERM', 'SIGKILL', 'SIGKILL']);
	assert.equal(child.stdout.destroyed, true);
	assert.equal(child.stderr.destroyed, true);
	assert.equal(child.abandoned, true);
	child.emit('close', 0, null);
});

test('smoke child treats an already vanished POSIX group as terminated', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const child = childFixture();
	const promise = runBoundedSmokeChild('command', [], options, {
		spawnChild: () => child, platform: 'linux',
		killGroup: () => { throw Object.assign(new Error('gone'), { code: 'ESRCH' }); },
	});
	const rejected = assert.rejects(promise, /timed out/u);
	t.mock.timers.tick(20);
	child.emit('close', 0, null);
	t.mock.timers.tick(250);
	await rejected;
	assert.equal(child.fallbackSignal, undefined);
});

test('smoke child uses Windows tree kill and retains fallback and abandonment', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const child = childFixture();
	const killers = [];
	const promise = runBoundedSmokeChild('command', [], options, {
		platform: 'win32',
		spawnChild: (command, args, spawnOptions) => {
			if (command === 'command') {
				assert.equal(spawnOptions.detached, false);
				return child;
			}
			assert.equal(command, 'taskkill.exe');
			assert.deepEqual(args, ['/PID', '123', '/T', '/F']);
			assert.deepEqual(spawnOptions, { stdio: 'ignore', windowsHide: true });
			const killer = new EventEmitter();
			killer.unref = () => { killer.unreferenced = true; };
			killers.push(killer);
			return killer;
		},
	});
	const rejected = assert.rejects(promise, /timed out/u);
	t.mock.timers.tick(20);
	assert.equal(killers.length, 1);
	assert.equal(killers[0].unreferenced, true);
	killers[0].emit('error', new Error('taskkill failed'));
	assert.equal(child.fallbackSignal, 'SIGKILL');
	t.mock.timers.tick(1_000);
	await rejected;
	assert.equal(killers.length, 2);
	assert.equal(child.abandoned, true);
});

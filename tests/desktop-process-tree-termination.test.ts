/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
	shouldDetachProcessTree,
	terminateProcessTree,
	type ProcessTreeChild,
	type ProcessTreeKillerChild,
} from '../desktop/process-tree-termination.ts';

test('POSIX children launch as process-group leaders and terminate by negative PID', async () => {
	assert.equal(shouldDetachProcessTree('linux'), true);
	assert.equal(shouldDetachProcessTree('darwin'), true);
	const directSignals: NodeJS.Signals[] = [];
	const groupSignals: Array<readonly [number, NodeJS.Signals]> = [];
	const child: ProcessTreeChild = { pid: 123, kill: (signal) => { directSignals.push(signal); return true; } };
	assert.equal(await terminateProcessTree(child, 'SIGTERM', {
		platform: 'linux',
		killGroup(pid, signal) { groupSignals.push([pid, signal]); },
	}), true);
	assert.deepEqual(groupSignals, [[-123, 'SIGTERM']]);
	assert.deepEqual(directSignals, []);
});

test('Windows terminates the complete PID tree through absolute System32 taskkill', async () => {
	assert.equal(shouldDetachProcessTree('win32'), false);
	const killer = fakeKiller();
	let launch: unknown;
	const child: ProcessTreeChild = { pid: 456, kill: () => { throw new Error('direct kill is not tree-safe'); } };
	const termination = terminateProcessTree(child, 'SIGKILL', {
		platform: 'win32', environment: { SystemRoot: 'C:\\Windows' },
		spawnTreeKiller(executable, argv, options) {
			launch = { executable, argv, options };
			queueMicrotask(() => killer.emit('close', 0, null));
			return killer;
		},
	});
	assert.equal(await termination, true);
	assert.deepEqual(launch, {
		executable: 'C:\\Windows\\System32\\taskkill.exe',
		argv: ['/PID', '456', '/T', '/F'],
		options: {
			env: { SystemRoot: 'C:\\Windows' }, shell: false,
			stdio: 'ignore', windowsHide: true,
		},
	});
});

test('tree-killer failure falls back to the immediate child and reports uncontained termination', async () => {
	const signals: NodeJS.Signals[] = [];
	const killer = fakeKiller();
	const child: ProcessTreeChild = { pid: 456, kill: (signal) => { signals.push(signal); return true; } };
	const termination = terminateProcessTree(child, 'SIGTERM', {
		platform: 'win32', environment: { WINDIR: 'C:\\Windows' },
		spawnTreeKiller() {
			queueMicrotask(() => killer.emit('close', 1, null));
			return killer;
		},
	});
	assert.equal(await termination, false);
	assert.deepEqual(signals, ['SIGTERM']);
});

function fakeKiller(): ProcessTreeKillerChild & EventEmitter {
	const child = new EventEmitter() as ProcessTreeKillerChild & EventEmitter;
	child.kill = () => true;
	return child;
}

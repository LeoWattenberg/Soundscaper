/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { desktopAssistanceCommandTimeout, runDesktopAssistanceBuildCommand,
	withDesktopAssistanceBuildWork } from '../scripts/lib/desktop-assistance-build-process.mjs';

function compiler() {
	return Object.assign(new EventEmitter(), {
		pid: 123, stdout: new PassThrough(), stderr: new PassThrough(),
		kill: () => true, unref: () => undefined,
	});
}

test('native compilation has its own bounded hour instead of the short configuration deadline', () => {
	assert.equal(desktopAssistanceCommandTimeout('cmake', ['--build', '/build']), 60 * 60_000);
	assert.equal(desktopAssistanceCommandTimeout('cmake', ['-S', '/source']), 15 * 60_000);
	assert.equal(desktopAssistanceCommandTimeout('engine', ['--version']), 15 * 60_000);
});

test('native commands retain separate output streams and the admitted build environment', async () => {
	const child = compiler();
	const operation = runDesktopAssistanceBuildCommand('compiler', ['build'], {
		cwd: '/build', env: { SOURCE_DATE_EPOCH: '123' }, label: 'Whisper',
	}, {
		platform: 'linux',
		spawnChild: (_executable: string, _args: string[], options: unknown) => {
			assert.deepEqual(options, { cwd: '/build', env: { SOURCE_DATE_EPOCH: '123' },
				windowsHide: true, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
			return child;
		},
	});
	child.stdout.write('version');
	child.stderr.write('warning');
	child.emit('close', 0, null);
	assert.deepEqual(await operation, { stdout: 'version', stderr: 'warning' });
	await assert.rejects(runDesktopAssistanceBuildCommand('soundscaper-missing-compiler-executable', [], {
		label: 'Whisper',
	}), /Whisper build failed.*ENOENT/u);
});

test('Windows timeout waits for the entire compiler tree and retains the original diagnostics', async context => {
	context.mock.timers.enable({ apis: ['setTimeout'] });
	const child = compiler();
	let finishTermination: (() => void) | undefined;
	const calls: unknown[] = [];
	const operation = runDesktopAssistanceBuildCommand('compiler', ['build'], { label: 'Whisper', timeout: 20 }, {
		platform: 'win32', spawnChild: () => child,
		terminateTree: (owned: unknown, platform: string) => {
			calls.push([owned, platform]);
			return new Promise<void>(resolve => { finishTermination = resolve; });
		},
	});
	let settled = false;
	const rejected = assert.rejects(operation, /Whisper.*timed out after 20 ms[\s\S]*compiling shader[\s\S]*warning/u)
		.then(() => { settled = true; });
	child.stdout.write('compiling shader');
	child.stderr.write('warning');
	context.mock.timers.tick(20);
	child.emit('error', new Error('secondary shutdown error'));
	child.emit('close', 1, null);
	await Promise.resolve();
	assert.equal(settled, false, 'Cleanup must wait for taskkill, not just cmake.exe.');
	assert.deepEqual(calls, [[child, 'win32']]);
	assert.ok(finishTermination);
	finishTermination();
	await rejected;
});

test('compiler errors and output overflow include their cause and captured output', async () => {
	for (const overflow of [false, true]) {
		const child = compiler();
		let terminated = false;
		const operation = runDesktopAssistanceBuildCommand('compiler', [], { label: 'llama.cpp', maxBuffer: 8 }, {
			spawnChild: () => child,
			terminateTree: () => { terminated = true; return Promise.resolve(); },
		});
		const rejected = assert.rejects(operation, overflow ? /output exceeds 8 bytes/u : /exit code 2[\s\S]*C1083/u);
		child.stdout.write('C1083');
		if (overflow) child.stderr.write('overflow');
		child.emit('close', 2, null);
		await rejected;
		assert.equal(terminated, overflow);
	}
});

test('large CMake progress logs stream in full without killing a compiler or retaining unbounded output', async () => {
	const child = compiler();
	let streamed = '', terminated = false;
	const operation = runDesktopAssistanceBuildCommand('cmake', ['--build', '/build'], {
		label: 'Whisper', maxBuffer: 8, onOutput: (text: string) => { streamed += text; },
	}, {
		spawnChild: () => child,
		terminateTree: () => { terminated = true; return Promise.resolve(); },
	});
	const rejected = assert.rejects(operation, error => {
		assert.ok(error instanceof Error);
		assert.match(error.message, /exit code 2[\s\S]*C1083/u);
		assert.doesNotMatch(error.message, /earlier progress/u);
		return true;
	});
	child.stdout.write('earlier progress that exceeds the capture bound\n');
	child.stderr.write('earlier warning that also exceeds the capture bound\n');
	child.stdout.write('C1083');
	child.emit('close', 2, null);
	await rejected;
	assert.match(streamed, /earlier progress[\s\S]*earlier warning[\s\S]*C1083/u);
	assert.equal(terminated, false);
});

test('failed compiler tree termination has an independent settlement bound', async context => {
	context.mock.timers.enable({ apis: ['setTimeout'] });
	const child = compiler();
	let abandoned = false;
	child.unref = () => { abandoned = true; };
	const operation = runDesktopAssistanceBuildCommand('compiler', [], { label: 'Whisper', timeout: 20 }, {
		spawnChild: () => child,
		terminateTree: () => Promise.reject(new Error('taskkill denied')),
	});
	const rejected = assert.rejects(operation, /timed out after 20 ms[\s\S]*taskkill denied/u);
	context.mock.timers.tick(20);
	await new Promise<void>(resolve => setImmediate(resolve));
	context.mock.timers.tick(15_000);
	await rejected;
	assert.equal(abandoned, true);
	assert.equal(child.stdout.destroyed, true);
	assert.equal(child.stderr.destroyed, true);
});

test('build cleanup retries Windows locks and preserves both the build error and cleanup error', async () => {
	const failure = new Error('Whisper timed out while compiling shaders');
	const locked = Object.assign(new Error('compiler directory remains busy'), { code: 'EBUSY' });
	await assert.rejects(withDesktopAssistanceBuildWork('/work', () => Promise.reject(failure), {
		remove: (_path: string, options: { maxRetries: number; retryDelay: number }) => {
			assert.ok(options.maxRetries >= 10);
			assert.ok(options.retryDelay >= 100);
			return Promise.reject(locked);
		},
	}), (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.deepEqual(error.errors, [failure, locked]);
		assert.equal(error.cause, failure);
		assert.match(error.message, /Whisper timed out[\s\S]*compiler directory remains busy/u);
		return true;
	});
	await assert.rejects(withDesktopAssistanceBuildWork('/work', () => Promise.resolve('built'), {
		remove: () => Promise.reject(locked),
	}), error => error === locked);
});

test('successful and failed builds remove their work without altering the operation result', async () => {
	const success = await mkdtemp(join(tmpdir(), 'assistance-build-success-'));
	assert.equal(await withDesktopAssistanceBuildWork(success, () => Promise.resolve(42)), 42);
	await assert.rejects(access(success), { code: 'ENOENT' });
	const failed = await mkdtemp(join(tmpdir(), 'assistance-build-failure-'));
	const failure = new Error('compile failed');
	await assert.rejects(withDesktopAssistanceBuildWork(failed, () => Promise.reject(failure)), error => error === failure);
	await assert.rejects(access(failed), { code: 'ENOENT' });
});

test('real timed-out compilers leave no running descendant or locked working directory', { timeout: 15_000 }, async context => {
	const root = await mkdtemp(join(tmpdir(), 'assistance compiler '));
	context.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
	await mkdir(join(root, 'compiler'));
	let output = '';
	const descendant = 'console.log("descendant=" + process.pid); setInterval(() => {}, 1000);';
	const program = `const { spawn } = require('node:child_process');
spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { cwd: 'compiler', stdio: 'inherit' });
setInterval(() => {}, 1000);`;
	await assert.rejects(runDesktopAssistanceBuildCommand(process.execPath, ['-e', program], {
		cwd: root, label: 'Whisper', timeout: 3_000,
		onOutput: (text: string) => { output += text; },
	}), /timed out after 3000 ms[\s\S]*descendant=/u);
	const pid = /descendant=(\d+)/u.exec(output)?.[1];
	assert.ok(pid, 'The compiler descendant must have started before the deadline.');
	if (process.platform === 'linux') {
		try {
			const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
			assert.match(stat, /\) Z /u, 'A terminated descendant may remain only as a reaped-process record.');
		} catch (error) {
			if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
		}
	}
	await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	await assert.rejects(access(root), { code: 'ENOENT' });
});

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
	createExternalFfmpegInstallerNodeRunner,
	type ExternalFfmpegInstallerChildProcess,
	type ExternalFfmpegInstallerSpawnOptions,
} from '../desktop/external-ffmpeg-installer-node-runtime.ts';
import type {
	ExternalFfmpegInstallRunnerRequest,
} from '../desktop/external-ffmpeg-installer.ts';

interface FakeChild extends ExternalFfmpegInstallerChildProcess {
	stdout: EventEmitter;
	stderr: EventEmitter;
	readonly kills: NodeJS.Signals[];
	emit(event: string, ...arguments_: unknown[]): boolean;
}

test('the Node adapter launches the exact executable and argv with no shell or stdin', async () => {
	const child = fakeChild();
	let launched: Readonly<{
		readonly executable: string;
		readonly argv: readonly string[];
		readonly options: ExternalFfmpegInstallerSpawnOptions;
	}> | undefined;
	const runner = createExternalFfmpegInstallerNodeRunner({
		spawn(executable, argv, options) {
			launched = { executable, argv, options };
			queueMicrotask(() => {
				child.stdout.emit('data', Buffer.from('installed'));
				child.stderr.emit('data', Buffer.from('notice'));
				child.emit('close', 0, null);
			});
			return child;
		},
	});
	const request = invocation();
	assert.deepEqual(await runner(request), {
		status: 'exited', exitCode: 0, signal: null, stdout: 'installed', stderr: 'notice',
	});
	assert.deepEqual(launched, {
		executable: 'winget.exe',
		argv: request.argv,
		options: {
			cwd: '/installer-cwd', env: { PATH: '/safe/bin', NO_COLOR: '1' },
			shell: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
		},
	});
	assert.equal(launched?.argv, request.argv, 'the adapter must not rewrite package-manager arguments');
});

test('nonzero exits and process signals retain their exact status', async () => {
	for (const [code, signal] of [[27, null], [null, 'SIGTERM']] as const) {
		const child = fakeChild();
		const runner = createExternalFfmpegInstallerNodeRunner({
			spawn() {
				queueMicrotask(() => child.emit('close', code, signal));
				return child;
			},
		});
		assert.deepEqual(await runner(invocation()), {
			status: 'exited', exitCode: code, signal, stdout: '', stderr: '',
		});
	}
});

test('ENOENT, EACCES, and other launch errors remain distinguishable failures', async () => {
	for (const [code, detail] of [
		['ENOENT', /ENOENT.*not found/iu],
		['EACCES', /EACCES.*not executable/iu],
		['EPERM', /EPERM.*not executable/iu],
		['EIO', /EIO.*could not be started/iu],
	] as const) {
		const runner = createExternalFfmpegInstallerNodeRunner({
			spawn() { throw Object.assign(new Error('launch failed'), { code }); },
		});
		const result = await runner(invocation());
		assert.equal(result.status, 'failed');
		if (result.status === 'failed') assert.match(result.detail, detail);
	}

	const child = fakeChild();
	const runner = createExternalFfmpegInstallerNodeRunner({ spawn: () => child });
	const running = runner(invocation());
	queueMicrotask(() => child.emit('error', Object.assign(new Error('missing'), { code: 'ENOENT' })));
	const result = await running;
	assert.equal(result.status, 'failed');
	if (result.status === 'failed') assert.match(result.detail, /ENOENT.*not found/iu);
});

test('an AbortSignal kills an active child and never reports installation success', async () => {
	const child = fakeChild({ closeOnKill: true });
	const controller = new AbortController();
	const runner = createExternalFfmpegInstallerNodeRunner({ spawn: () => child });
	const running = runner(invocation({ signal: controller.signal }));
	child.stdout.emit('data', Buffer.from('partial'));
	controller.abort(new Error('user cancelled'));
	assert.deepEqual(await running, {
		status: 'cancelled', detail: 'user cancelled', stdout: 'partial', stderr: '',
	});
	assert.deepEqual(child.kills, ['SIGKILL']);

	const cancelled = new AbortController();
	cancelled.abort();
	let spawns = 0;
	const beforeSpawn = await createExternalFfmpegInstallerNodeRunner({
		spawn() { spawns += 1; return fakeChild(); },
	})(invocation({ signal: cancelled.signal }));
	assert.equal(beforeSpawn.status, 'cancelled');
	assert.equal(spawns, 0);
});

test('the runner owns a timeout, kills the child, and waits for process close', async () => {
	const child = fakeChild({ closeOnKill: true });
	const runner = createExternalFfmpegInstallerNodeRunner({ spawn: () => child });
	const result = await runner(invocation({ timeoutMs: 10 }));
	assert.equal(result.status, 'failed');
	if (result.status === 'failed') assert.match(result.detail, /timed out/iu);
	assert.deepEqual(child.kills, ['SIGKILL']);
});

test('combined output is capped before an output flood can grow memory', async () => {
	const child = fakeChild({ closeOnKill: true });
	const runner = createExternalFfmpegInstallerNodeRunner({ spawn: () => child });
	const running = runner(invocation({ maximumOutputBytes: 1_024 }));
	child.stdout.emit('data', Buffer.alloc(1_000, 0x80));
	child.stderr.emit('data', Buffer.alloc(100, 98));
	const result = await running;
	assert.equal(result.status, 'failed');
	if (result.status !== 'failed') return;
	assert.match(result.detail, /output limit/iu);
	assert.ok(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) <= 1_024);
	assert.deepEqual(child.kills, ['SIGKILL']);
});

test('the default adapter executes a real Node child without a command shell', async () => {
	const base = invocation();
	const result = await createExternalFfmpegInstallerNodeRunner()({
		...base,
		executable: process.execPath,
		argv: ['-e', 'process.stdout.write("real-child"); process.stderr.write("real-stderr")'],
		options: {
			...base.options,
			cwd: process.cwd(),
			env: runtimeEnvironment(),
		},
	});
	assert.deepEqual(result, {
		status: 'exited', exitCode: 0, signal: null,
		stdout: 'real-child', stderr: 'real-stderr',
	});
});

test('termination has a bounded fallback when a hostile child never closes', async () => {
	const child = fakeChild();
	const runner = createExternalFfmpegInstallerNodeRunner({
		spawn: () => child, terminationWaitMs: 10,
	});
	const controller = new AbortController();
	const running = runner(invocation({ signal: controller.signal }));
	controller.abort();
	const result = await running;
	assert.equal(result.status, 'cancelled');
	assert.deepEqual(child.kills, ['SIGKILL']);
});

test('malformed invocations fail before any process is spawned', () => {
	let spawns = 0;
	const runner = createExternalFfmpegInstallerNodeRunner({
		spawn() { spawns += 1; return fakeChild(); },
	});
	assert.throws(() => runner({
		...invocation(), argv: ['install', 'ffmpeg\0malicious'],
	}), /installer runner request/iu);
	assert.throws(() => runner({
		...invocation(), options: { ...invocation().options, shell: true as never },
	}), /installer runner request/iu);
	assert.equal(spawns, 0);
});

function invocation(overrides: Readonly<{
	readonly signal?: AbortSignal;
	readonly timeoutMs?: number;
	readonly maximumOutputBytes?: number;
}> = {}): ExternalFfmpegInstallRunnerRequest {
	return {
		executable: 'winget.exe',
		argv: [
			'install', '--exact', '--id', 'BtbN.FFmpeg.GPL.8.1',
			'--source', 'winget', '--architecture', 'x64',
		],
		options: {
			cwd: '/installer-cwd', env: { PATH: '/safe/bin', NO_COLOR: '1' },
			shell: false, stdin: 'ignore', stdout: 'capture', stderr: 'capture',
			timeoutMs: overrides.timeoutMs ?? 5_000,
			maximumOutputBytes: overrides.maximumOutputBytes ?? 8_192,
			signal: overrides.signal ?? new AbortController().signal,
		},
	};
}

function fakeChild(options: Readonly<{ readonly closeOnKill?: boolean }> = {}): FakeChild {
	const child = new EventEmitter() as unknown as FakeChild;
	child.stdout = new EventEmitter();
	child.stderr = new EventEmitter();
	Object.defineProperty(child, 'kills', { value: [] });
	child.kill = (signal) => {
		child.kills.push(signal);
		if (options.closeOnKill) queueMicrotask(() => child.emit('close', null, signal));
		return true;
	};
	return child;
}

function runtimeEnvironment(): Readonly<Record<string, string>> {
	const result: Record<string, string> = {};
	for (const key of ['PATH', 'SystemRoot', 'TEMP', 'TMP', 'WINDIR']) {
		const value = process.env[key];
		if (value !== undefined) result[key] = value;
	}
	return result;
}

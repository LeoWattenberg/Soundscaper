/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';

import {
	createExternalFfmpegAudioOperationRunner,
	type ExternalFfmpegAudioChildProcess,
	type ExternalFfmpegAudioLaunchOptions,
	type ExternalFfmpegAudioOperationFiles,
	type ExternalFfmpegAudioOperationContract,
} from '../desktop/external-ffmpeg-audio-operation-runner.ts';

interface Operation {
	readonly codec: 'opus';
}

interface FakeChild extends ExternalFfmpegAudioChildProcess {
	stdout: EventEmitter;
	stderr: EventEmitter;
	readonly kills: NodeJS.Signals[];
	emit(event: string, ...arguments_: unknown[]): boolean;
}

test('an admitted operation launches only main-built argv in a private scratch directory', async (context) => {
	const root = await temporaryRoot(context);
	const child = fakeChild();
	const events: string[] = [];
	let files: Readonly<{ readonly inputPath: string; readonly outputPath: string }> | undefined;
	let launch: Readonly<{
		readonly executable: string;
		readonly argv: readonly string[];
		readonly options: ExternalFfmpegAudioLaunchOptions;
	}> | undefined;
	const runner = createExternalFfmpegAudioOperationRunner({
		scratchRoot: root,
		contract: contract({
			onBuild(next) { events.push('build'); files = next; },
			onValidate() { events.push('validate'); return true; },
		}),
		getAdmittedExecutable: () => Promise.resolve({
			executablePath: '/opt/ffmpeg/bin/ffmpeg', ffmpegSha256: 'a'.repeat(64),
		}),
		digestExecutable: () => { events.push('hash'); return Promise.resolve('a'.repeat(64)); },
		environment: {
			PATH: '/untrusted/bin', SystemRoot: 'C:\\Windows', WINDIR: 'C:\\Windows',
			HOME: '/leak', FFREPORT: 'file=/leak/report', LD_PRELOAD: '/leak/inject.so',
			DYLD_INSERT_LIBRARIES: '/leak/inject.dylib', AV_LOG_FORCE_COLOR: '1',
		},
		maximumInputBytes: 16,
		maximumOutputBytes: 16,
		maximumLogBytes: 32,
		spawn(executable, argv, options) {
			events.push('spawn');
			launch = { executable, argv, options };
			void complete(child, files?.outputPath, Uint8Array.of(4, 5, 6));
			return child;
		},
	});

	const result = await runner.execute({ operation: { codec: 'opus' }, input: Uint8Array.of(1, 2, 3) });
	assert.deepEqual(result, { status: 'executed', output: Uint8Array.of(4, 5, 6), log: 'encoded' });
	assert.ok(files);
	assert.deepEqual(events, ['build', 'validate', 'hash', 'spawn']);
	assert.equal(launch?.executable, '/opt/ffmpeg/bin/ffmpeg');
	assert.deepEqual(launch?.argv, [
		'-nostdin', '-hide_banner', '-nostats', '-loglevel', 'error', '-y',
		'-protocol_whitelist', 'file,crypto,data',
		'-i', files.inputPath, '-map', '0:a:0', '-c:a', 'libopus', '-f', 'ogg',
		'-fs', '16', files.outputPath,
	]);
	assert.equal(launch?.options.cwd, dirname(files.inputPath));
	assert.deepEqual(launch?.options, {
		cwd: dirname(files.inputPath),
		env: {
			AV_LOG_FORCE_NOCOLOR: '1', HOME: dirname(files.inputPath), LANG: 'C', LC_ALL: 'C',
			NO_COLOR: '1', SystemRoot: 'C:\\Windows', TEMP: dirname(files.inputPath),
			TMP: dirname(files.inputPath), TMPDIR: dirname(files.inputPath),
			USERPROFILE: dirname(files.inputPath), WINDIR: 'C:\\Windows',
		},
		shell: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
	});
	await assertRemoved(dirname(files.inputPath));
});

test('renderer-shaped paths and argv are rejected before a contract or process sees them', async (context) => {
	const root = await temporaryRoot(context);
	let admitted = 0;
	let spawned = 0;
	const runner = createExternalFfmpegAudioOperationRunner({
		scratchRoot: root,
		contract: contract({ onAdmit() { admitted += 1; } }),
		getAdmittedExecutable: admittedExecutable,
		digestExecutable: admittedDigest,
		maximumInputBytes: 3,
		spawn() { spawned += 1; return fakeChild(); },
	});
	const rendererRequest = {
		operation: { codec: 'opus' }, input: Uint8Array.of(1),
		argv: ['-i', '/renderer/file'], outputPath: '/renderer/output',
	};
	assert.deepEqual(await runner.execute(rendererRequest), unavailable('request-rejected'));
	assert.deepEqual(await runner.execute({
		operation: { codec: 'opus' }, input: Uint8Array.of(1, 2, 3, 4),
	}), unavailable('input-limit'));
	assert.equal(admitted, 0);
	assert.equal(spawned, 0);
});

test('the operation contract must admit the request and validate its own exact argv', async (context) => {
	const root = await temporaryRoot(context);
	const scratchDirectories: string[] = [];
	let spawned = 0;
	const runner = createExternalFfmpegAudioOperationRunner({
		scratchRoot: root,
		contract: contract({
			onBuild(files) { scratchDirectories.push(dirname(files.inputPath)); },
			onValidate() { return false; },
		}),
		getAdmittedExecutable: admittedExecutable,
		digestExecutable: admittedDigest,
		spawn() { spawned += 1; return fakeChild(); },
	});
	assert.deepEqual(await runner.execute({
		operation: { codec: 'opus' }, input: Uint8Array.of(1),
	}), unavailable('contract-rejected'));
	assert.equal(spawned, 0);
	assert.equal(scratchDirectories.length, 1);
	await assertRemoved(scratchDirectories[0]);

	const rejecting = createExternalFfmpegAudioOperationRunner({
		scratchRoot: root,
		contract: contract({ reject: true }),
		getAdmittedExecutable: admittedExecutable,
		digestExecutable: admittedDigest,
	});
	assert.deepEqual(await rejecting.execute({
		operation: { codec: 'opus' }, input: Uint8Array.of(1),
	}), unavailable('request-rejected'));
});

test('the executable is re-hashed immediately before spawn and identity drift is terminal', async (context) => {
	const root = await temporaryRoot(context);
	let scratchDirectory = '';
	let spawned = 0;
	const runner = createExternalFfmpegAudioOperationRunner({
		scratchRoot: root,
		contract: contract({ onBuild(files) { scratchDirectory = dirname(files.inputPath); } }),
		getAdmittedExecutable: admittedExecutable,
		digestExecutable: () => Promise.resolve('b'.repeat(64)),
		spawn() { spawned += 1; return fakeChild(); },
	});
	assert.deepEqual(await runner.execute({
		operation: { codec: 'opus' }, input: Uint8Array.of(1),
	}), unavailable('identity-changed'));
	assert.equal(spawned, 0);
	await assertRemoved(scratchDirectory);
});

test('the runner is single-flight until the active process has exited and cleanup completes', async (context) => {
	const root = await temporaryRoot(context);
	const child = fakeChild();
	let outputPath = '';
	const runner = createExternalFfmpegAudioOperationRunner({
		scratchRoot: root,
		contract: contract({ onBuild(files) { outputPath = files.outputPath; } }),
		getAdmittedExecutable: admittedExecutable,
		digestExecutable: admittedDigest,
		spawn: () => child,
	});
	const first = runner.execute({ operation: { codec: 'opus' }, input: Uint8Array.of(1) });
	await until(() => outputPath !== '');
	assert.deepEqual(await runner.execute({
		operation: { codec: 'opus' }, input: Uint8Array.of(2),
	}), unavailable('busy'));
	await writeFile(outputPath, Uint8Array.of(9));
	child.emit('close', 0, null);
	assert.deepEqual(await first, { status: 'executed', output: Uint8Array.of(9), log: '' });
});

test('AbortSignal cancellation escalates from TERM to KILL and still removes scratch files', async (context) => {
	const root = await temporaryRoot(context);
	const child = fakeChild({ closeOnKill: true });
	const controller = new AbortController();
	let scratchDirectory = '';
	const runner = createExternalFfmpegAudioOperationRunner({
		scratchRoot: root,
		contract: contract({ onBuild(files) { scratchDirectory = dirname(files.inputPath); } }),
		getAdmittedExecutable: admittedExecutable,
		digestExecutable: admittedDigest,
		terminationGraceMs: 1,
		killWaitMs: 20,
		spawn: () => child,
	});
	const running = runner.execute({
		operation: { codec: 'opus' }, input: Uint8Array.of(1), signal: controller.signal,
	});
	await until(() => scratchDirectory !== '');
	controller.abort();
	assert.deepEqual(await running, unavailable('cancelled'));
	assert.deepEqual(child.kills, ['SIGTERM', 'SIGKILL']);
	await assertRemoved(scratchDirectory);
});

test('runtime, log, output, and process failures remain typed and bounded', async (context) => {
	const root = await temporaryRoot(context);
	const timedOut = fakeChild({ closeOnKill: true });
	const timeoutRunner = createExternalFfmpegAudioOperationRunner({
		scratchRoot: root, contract: contract(), getAdmittedExecutable: admittedExecutable,
		digestExecutable: admittedDigest, maximumDurationMs: 1, terminationGraceMs: 1,
		killWaitMs: 20, spawn: () => timedOut,
	});
	assert.deepEqual(await timeoutRunner.execute(operationRequest()), unavailable('timeout'));
	assert.deepEqual(timedOut.kills, ['SIGTERM', 'SIGKILL']);

	const flooding = fakeChild({ closeOnKill: true });
	const logRunner = createExternalFfmpegAudioOperationRunner({
		scratchRoot: root, contract: contract(), getAdmittedExecutable: admittedExecutable,
		digestExecutable: admittedDigest, maximumLogBytes: 4, terminationGraceMs: 1,
		killWaitMs: 20,
		spawn() { queueMicrotask(() => flooding.stderr.emit('data', Buffer.from('123456'))); return flooding; },
	});
	assert.deepEqual(await logRunner.execute(operationRequest()), {
		...unavailable('log-limit'), log: '1234',
	});

	let outputPath = '';
	const oversized = fakeChild();
	const outputRunner = createExternalFfmpegAudioOperationRunner({
		scratchRoot: root,
		contract: contract({ onBuild(files) { outputPath = files.outputPath; } }),
		getAdmittedExecutable: admittedExecutable,
		digestExecutable: admittedDigest,
		maximumOutputBytes: 2,
		spawn() { void complete(oversized, outputPath, Uint8Array.of(1, 2, 3)); return oversized; },
	});
	assert.deepEqual(await outputRunner.execute(operationRequest()), unavailable('output-limit', 'encoded'));

	const failed = fakeChild();
	const failureRunner = createExternalFfmpegAudioOperationRunner({
		scratchRoot: root, contract: contract(), getAdmittedExecutable: admittedExecutable,
		digestExecutable: admittedDigest,
		spawn() { queueMicrotask(() => failed.emit('close', 7, null)); return failed; },
	});
	assert.deepEqual(await failureRunner.execute(operationRequest()), {
		...unavailable('process-failed'), exitCode: 7,
	});
});

test('the trusted contract can narrow the per-operation output limit', async (context) => {
	const root = await temporaryRoot(context);
	const child = fakeChild();
	let outputPath = '';
	let launchedArguments: readonly string[] = [];
	const runner = createExternalFfmpegAudioOperationRunner({
		scratchRoot: root,
		contract: contract({
			maximumOutputBytes: 2,
			onBuild(files) { outputPath = files.outputPath; assert.equal(files.maximumOutputBytes, 2); },
		}),
		getAdmittedExecutable: admittedExecutable,
		digestExecutable: admittedDigest,
		maximumOutputBytes: 16,
		spawn(_executable, arguments_) {
			launchedArguments = arguments_;
			void complete(child, outputPath, Uint8Array.of(1, 2, 3));
			return child;
		},
	});
	assert.deepEqual(await runner.execute(operationRequest()), unavailable('output-limit', 'encoded'));
	assert.deepEqual(launchedArguments.slice(-3), ['-fs', '2', outputPath]);
});

function contract(options: Readonly<{
	reject?: boolean;
	maximumOutputBytes?: number;
	onAdmit?(): void;
	onBuild?(files: ExternalFfmpegAudioOperationFiles): void;
	onValidate?(): boolean;
}> = {}): ExternalFfmpegAudioOperationContract<Operation> {
	return {
		maximumOutputBytes: () => options.maximumOutputBytes,
		admitOperation(value) {
			options.onAdmit?.();
			return options.reject || !value || typeof value !== 'object'
				|| (value as { codec?: unknown }).codec !== 'opus'
				? { status: 'rejected' }
				: { status: 'admitted', operation: { codec: 'opus' } };
		},
		buildArguments(_operation, files) {
			options.onBuild?.(files);
			return ['-i', files.inputPath, '-map', '0:a:0', '-c:a', 'libopus', '-f', 'ogg', files.outputPath];
		},
		validateArguments() { return options.onValidate?.() ?? true; },
	};
}

function admittedExecutable(): Promise<Readonly<{
	readonly executablePath: string;
	readonly ffmpegSha256: string;
}>> {
	return Promise.resolve({ executablePath: '/tools/ffmpeg', ffmpegSha256: 'a'.repeat(64) });
}

function admittedDigest(): Promise<string> {
	return Promise.resolve('a'.repeat(64));
}

function operationRequest(): Readonly<{ readonly operation: Operation; readonly input: Uint8Array }> {
	return { operation: { codec: 'opus' }, input: Uint8Array.of(1) };
}

function unavailable(reason: string, log = ''): Readonly<{
	readonly status: 'unavailable'; readonly reason: string; readonly detail: string; readonly log: string;
}> {
	const details: Readonly<Record<string, string>> = {
		busy: 'Another external FFmpeg audio operation is already active.',
		cancelled: 'The external FFmpeg audio operation was cancelled.',
		'contract-rejected': 'The external FFmpeg operation contract rejected its generated arguments.',
		'identity-changed': 'The selected FFmpeg executable changed after it was admitted.',
		'input-limit': 'The external FFmpeg audio input exceeds its byte limit.',
		'log-limit': 'The external FFmpeg process exceeded its log limit.',
		'output-limit': 'The external FFmpeg audio output exceeds its byte limit.',
		'process-failed': 'The external FFmpeg process returned a nonzero exit code.',
		'request-rejected': 'The external FFmpeg audio operation request was rejected.',
		timeout: 'The external FFmpeg audio operation exceeded its runtime limit.',
	};
	return { status: 'unavailable', reason, detail: details[reason] ?? reason, log };
}

function fakeChild(options: Readonly<{ readonly closeOnKill?: boolean }> = {}): FakeChild {
	const child = new EventEmitter() as unknown as FakeChild;
	child.stdout = new EventEmitter();
	child.stderr = new EventEmitter();
	Object.defineProperty(child, 'kills', { value: [] });
	child.kill = (signal) => {
		child.kills.push(signal);
		if (options.closeOnKill && signal === 'SIGKILL') queueMicrotask(() => child.emit('close', null, signal));
		return true;
	};
	return child;
}

async function complete(child: FakeChild, outputPath: string | undefined, bytes: Uint8Array): Promise<void> {
	if (!outputPath) {
		child.emit('error', new Error('The test did not receive an output path.'));
		return;
	}
	await writeFile(outputPath, bytes);
	child.stderr.emit('data', Buffer.from('encoded'));
	child.emit('close', 0, null);
}

async function temporaryRoot(context: TestContext): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-ffmpeg-audio-operation-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	return root;
}

async function assertRemoved(path: string): Promise<void> {
	await assert.rejects(access(path), (error: unknown) => (
		Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
	));
}

async function until(condition: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (condition()) return;
		await new Promise<void>((resolve) => { setTimeout(resolve, 1); });
	}
	throw new Error('Timed out waiting for the test condition.');
}

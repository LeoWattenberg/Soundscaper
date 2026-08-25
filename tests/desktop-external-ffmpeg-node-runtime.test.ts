/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
	createExternalFfmpegCandidateLocator,
	createExternalFfmpegNodeRunner,
	createExternalFfmpegProbeEvidence,
	externalFfmpegPairFromSelection,
	resolveExternalFfmpegTarget,
	type ExternalFfmpegChildProcess,
} from '../desktop/external-ffmpeg-node-runtime.ts';
import type {
	ExternalFfmpegProcessRequest,
	ExternalFfmpegProbeResult,
} from '../desktop/external-ffmpeg-probe.ts';

interface FakeExternalFfmpegChild extends ExternalFfmpegChildProcess {
	stdout: EventEmitter;
	stderr: EventEmitter;
	readonly kills: string[];
	emit(event: string, ...arguments_: unknown[]): boolean;
}

test('the external FFmpeg target matrix has five rows and keeps mac x64 retired', () => {
	assert.equal(resolveExternalFfmpegTarget('win32', 'x64'), 'win-x64');
	assert.equal(resolveExternalFfmpegTarget('win32', 'arm64'), 'win-arm64');
	assert.equal(resolveExternalFfmpegTarget('darwin', 'arm64'), 'mac-arm64');
	assert.equal(resolveExternalFfmpegTarget('linux', 'x64'), 'linux-x64');
	assert.equal(resolveExternalFfmpegTarget('linux', 'arm64'), 'linux-arm64');
	assert.throws(() => resolveExternalFfmpegTarget('darwin', 'x64'), /unsupported.*darwin-x64/iu);
});

test('manual selection derives only a sibling ffprobe executable', () => {
	assert.deepEqual(externalFfmpegPairFromSelection('/opt/homebrew/bin/ffmpeg', 'darwin'), {
		ffmpegPath: '/opt/homebrew/bin/ffmpeg',
		ffprobePath: '/opt/homebrew/bin/ffprobe',
	});
	assert.deepEqual(externalFfmpegPairFromSelection('C:\\Tools\\ffmpeg.exe', 'win32'), {
		ffmpegPath: 'C:\\Tools\\ffmpeg.exe',
		ffprobePath: 'C:\\Tools\\ffprobe.exe',
	});
	for (const path of ['/tools/ffprobe', '/tools/ffmpeg.sh', '../ffmpeg', '/tools/ffmpeg\0other']) {
		assert.throws(() => externalFfmpegPairFromSelection(path, 'linux'), /FFmpeg selection/iu);
	}
});

test('candidate discovery preserves manual, managed, package-manager, PATH priority', async () => {
	const executable = new Set([
		'/manual/ffmpeg', '/manual/ffprobe',
		'/managed/ffmpeg', '/managed/ffprobe',
		'/home/linuxbrew/.linuxbrew/bin/ffmpeg', '/home/linuxbrew/.linuxbrew/bin/ffprobe',
		'/usr/bin/ffmpeg', '/usr/bin/ffprobe',
	]);
	const locator = createExternalFfmpegCandidateLocator({
		platform: 'linux', arch: 'arm64',
		selectedPath: '/manual/ffmpeg', managedPath: '/managed/ffmpeg',
		environment: { PATH: '/relative:/usr/bin:/home/linuxbrew/.linuxbrew/bin' },
		isExecutable: (path) => Promise.resolve(executable.has(path)),
	});
	const candidates = await locator.discover();
	assert.deepEqual(candidates.map(({ id, source, ffmpegPath }) => ({ id, source, ffmpegPath })), [
		{ id: 'user-selected', source: 'user-selected', ffmpegPath: '/manual/ffmpeg' },
		{ id: 'managed-package', source: 'managed-package', ffmpegPath: '/managed/ffmpeg' },
		{ id: 'package-manager-1', source: 'package-manager', ffmpegPath: '/home/linuxbrew/.linuxbrew/bin/ffmpeg' },
		{ id: 'system-path-1', source: 'system-path', ffmpegPath: '/usr/bin/ffmpeg' },
	]);
	assert.equal(Object.isFrozen(candidates), true);
});

test('the Node runner launches exact argv without a shell or stdin', async () => {
	const launched: unknown[][] = [];
	const child = fakeChild();
	const runner = createExternalFfmpegNodeRunner({
		workingDirectory: '/private/scratch',
		environment: { PATH: '/usr/bin', HOME: '/private/home', FFREPORT: 'leak' },
		launch(executablePath, arguments_, options) {
			launched.push([executablePath, arguments_, options]);
			queueMicrotask(() => {
				child.stdout.emit('data', Buffer.from('ffmpeg version 9.0.1\n'));
				child.stderr.emit('data', Buffer.from(''));
				child.emit('close', 0, null);
			});
			return child;
		},
	});
	const result = await runner.run(request());
	assert.deepEqual(result, {
		status: 'exited', exitCode: 0, stdout: 'ffmpeg version 9.0.1\n', stderr: '',
	});
	assert.deepEqual(launched, [[
		'/tools/ffmpeg', ['-version'], {
			cwd: '/private/scratch', env: {
				AV_LOG_FORCE_NOCOLOR: '1', HOME: '/private/home', LANG: 'C', LC_ALL: 'C', PATH: '/usr/bin',
			},
			shell: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
		},
	]]);
});

test('the Node runner terminates an output flood and returns a typed reason', async () => {
	const child = fakeChild();
	const runner = createExternalFfmpegNodeRunner({
		workingDirectory: '/scratch',
		environment: {},
		launch() {
			queueMicrotask(() => child.stdout.emit('data', Buffer.alloc(33)));
			return child;
		},
	});
	assert.deepEqual(await runner.run({ ...request(), maximumOutputBytes: 32 }), {
		status: 'unavailable', reason: 'output-limit',
	});
	assert.deepEqual(child.kills, ['SIGKILL']);
});

test('probe evidence binds the exact executable pair and capabilities', async () => {
	const probe = availableProbe();
	const digests = new Map([
		['/tools/ffmpeg', '1'.repeat(64)],
		['/tools/ffprobe', '2'.repeat(64)],
	]);
	const digestCalls: string[] = [];
	const evidence = await createExternalFfmpegProbeEvidence({
		probe,
		digestFile: (path) => {
			digestCalls.push(path);
			return Promise.resolve(digests.get(path) ?? Promise.reject(new Error('missing')));
		},
		now: () => 1_787_605_200_000,
	});
	assert.equal(evidence.executablePath, '/tools/ffmpeg');
	assert.deepEqual(evidence.identity, {
		version: '9.0.1',
		ffmpegSha256: '1'.repeat(64),
		ffprobePath: '/tools/ffprobe',
		ffprobeSha256: '2'.repeat(64),
		executablePairClosureSha256: '810594fedcdf67cf8e386da7f22501884828fac6c73d0acc85f4496687ffa516',
	});
	assert.deepEqual(digestCalls, ['/tools/ffmpeg', '/tools/ffprobe']);
	assert.deepEqual(evidence.capabilities, {
		digest: '266381af0961177e20922326f8f009b99661dccb62c1b44152564a646f816632',
		probedAtEpochMs: 1_787_605_200_000,
	});
	assert.equal(Object.isFrozen(evidence.identity), true);
});

function request(): ExternalFfmpegProcessRequest {
	return {
		executablePath: '/tools/ffmpeg', arguments: ['-version'], shell: false,
		standardInput: 'ignore', maximumDurationMs: 5_000, maximumOutputBytes: 1_024,
	};
}

function fakeChild(): FakeExternalFfmpegChild {
	const child = new EventEmitter() as unknown as FakeExternalFfmpegChild;
	child.stdout = new EventEmitter();
	child.stderr = new EventEmitter();
	Object.defineProperty(child, 'kills', { value: [] });
	child.kill = (signal) => { child.kills.push(signal); return true; };
	return child;
}

function availableProbe(): Extract<ExternalFfmpegProbeResult, { status: 'available' }> {
	return {
		status: 'available',
		candidate: {
			id: 'manual', source: 'user-selected',
			ffmpegPath: '/tools/ffmpeg', ffprobePath: '/tools/ffprobe',
		},
		version: { raw: '9.0.1', normalized: '9.0.1', major: 9, minor: 0, patch: 1 },
		capabilities: {
			encoders: ['libopus'], decoders: ['opus'], muxers: ['opus'],
			demuxers: ['ogg'], filters: ['aresample'],
		},
	};
}

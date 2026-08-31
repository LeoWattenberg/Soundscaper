/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { externalFfmpegExecutablePairClosureSha256 } from '../desktop/external-ffmpeg-node-runtime.ts';
import {
	createExternalFfmpegShotDetector,
	ExternalFfmpegShotDetectorError,
	type ExternalFfmpegShotChildProcess,
	type ExternalFfmpegShotLaunchOptions,
	type ExternalFfmpegShotSpawn,
} from '../desktop/external-ffmpeg-shot-detector.ts';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const FFMPEG = '/opt/ffmpeg';
const FFPROBE = '/opt/ffprobe';
const WORKING_DIRECTORY = '/private/shot-detection';
const SOURCE = `${WORKING_DIRECTORY}/source.media`;
const SCENE_FILTER = "scdet=threshold=10,metadata=mode=print:file='pipe\\:4':direct=1,metadata=mode=select:key=lavfi.scd.time,showinfo";

test('verifies scdet functionally then detects through one exact shell-free source grammar', async () => {
	const launches: Launch[] = [];
	const digests: string[] = [];
	const detector = createExternalFfmpegShotDetector({
		pair: pair(), workingDirectory: WORKING_DIRECTORY,
		digestExecutable: async (path) => { digests.push(path); return exactDigest(path); },
		environment: { PATH: '/host/bin', SystemRoot: 'C:\\Windows' },
		spawn: successfulSpawn(launches),
	});

	assert.deepEqual(await detector.verify(), {
		schemaVersion: 1,
		detector: 'ffmpeg-scdet',
		executablePairClosureSha256: pair().executablePairClosureSha256,
		canary: { sourceFrameCount: 4, boundarySourceFrame: 2 },
	});
	assert.deepEqual(await detector.detect({ sourcePath: SOURCE }), {
		schemaVersion: 1,
		detector: 'ffmpeg-scdet',
		timescale: 90_000,
		sourceFrameCount: 3,
		boundaries: [{ sourceFrame: 2, presentationTick: '6006', score: 0.425 }],
	});

	assert.equal(launches.length, 2);
	assert.deepEqual(launches[0]?.arguments_, canaryArguments());
	assert.deepEqual(launches[1]?.arguments_, detectionArguments());
	for (const launch of launches) {
		assert.equal(launch.executable, FFMPEG);
		assert.equal(launch.options.cwd, WORKING_DIRECTORY);
		assert.equal(launch.options.shell, false);
		assert.deepEqual(launch.options.stdio, ['ignore', 'ignore', 'pipe', 'ignore', 'pipe']);
		assert.equal(launch.options.windowsHide, true);
		assert.equal(launch.options.detached, process.platform !== 'win32');
		assert.equal(launch.options.env.PATH, undefined);
		assert.equal(launch.options.env.HOME, WORKING_DIRECTORY);
		assert.equal(launch.options.env.TMPDIR, WORKING_DIRECTORY);
		assert.equal(launch.options.env.SystemRoot, 'C:\\Windows');
	}
	assert.deepEqual(digests, [
		FFMPEG, FFPROBE, FFMPEG, FFPROBE,
		FFMPEG, FFPROBE, FFMPEG, FFPROBE,
	]);
});

test('requires its own successful automatic verification and rejects argv-shaped requests', async () => {
	let launches = 0;
	const detector = createExternalFfmpegShotDetector({
		pair: pair(), workingDirectory: WORKING_DIRECTORY, digestExecutable: exactDigest,
		spawn: () => { launches += 1; return fakeChild(); },
	});
	await rejectsReason(detector.detect({ sourcePath: SOURCE }), 'not-verified');
	await rejectsReason(detector.detect({
		sourcePath: SOURCE, arguments: ['-i', '/outside'] as readonly string[],
	} as never), 'request-rejected');
	await rejectsReason(detector.detect({ sourcePath: '/outside/source.media' }), 'request-rejected');
	assert.equal(launches, 0);
});

test('rejects invalid pair authority and unknown factory options before launch', () => {
	assert.throws(() => createExternalFfmpegShotDetector({
		pair: { ...pair(), ffprobeSha256: 'c'.repeat(64) },
		workingDirectory: WORKING_DIRECTORY, digestExecutable: exactDigest,
	}), /options|pair|invalid/iu);
	assert.throws(() => createExternalFfmpegShotDetector({
		pair: pair(), workingDirectory: WORKING_DIRECTORY, digestExecutable: exactDigest,
		arguments: ['-version'],
	} as never), /options|invalid/iu);
});

test('fails closed when either executable identity changes before or after verification', async () => {
	for (const driftAfterDigestCall of [0, 2]) {
		let calls = 0;
		let launches = 0;
		const detector = createExternalFfmpegShotDetector({
			pair: pair(), workingDirectory: WORKING_DIRECTORY,
			digestExecutable: async (path) => {
				calls += 1;
				return calls > driftAfterDigestCall ? 'c'.repeat(64) : exactDigest(path);
			},
			spawn: (...arguments_) => { launches += 1; return successfulSpawn([])(...arguments_); },
		});
		await rejectsReason(detector.verify(), 'identity-changed');
		assert.equal(launches, driftAfterDigestCall === 0 ? 0 : 1);
		await rejectsReason(detector.detect({ sourcePath: SOURCE }), 'not-verified');
	}
});

test('withholds a completed detection result when the admitted pair drifts during execution', async () => {
	let calls = 0;
	const launches: Launch[] = [];
	const detector = createExternalFfmpegShotDetector({
		pair: pair(), workingDirectory: WORKING_DIRECTORY,
		digestExecutable: async (path) => {
			calls += 1;
			return calls > 6 ? 'c'.repeat(64) : exactDigest(path);
		},
		spawn: successfulSpawn(launches),
	});
	await detector.verify();
	await rejectsReason(detector.detect({ sourcePath: SOURCE }), 'identity-changed');
	await rejectsReason(detector.detect({ sourcePath: SOURCE }), 'not-verified');
	assert.equal(launches.length, 2);
});

test('does not verify a filter graph that fails the known black-to-white cut canary', async () => {
	for (const metadata of [
		metadataFrames([0, 1_000_000, 2_000_000, 3_000_000]),
		metadataFrames([0, 1_000_000, 2_000_000, 3_000_000], 3),
	]) {
		const detector = createExternalFfmpegShotDetector({
			pair: pair(), workingDirectory: WORKING_DIRECTORY, digestExecutable: exactDigest,
			spawn: outputSpawn('[showinfo] config in time_base: 1/1000000, frame_rate: 1/1\n', metadata),
		});
		await rejectsReason(detector.verify(), 'canary-failed');
		await rejectsReason(detector.detect({ sourcePath: SOURCE }), 'not-verified');
	}
});

test('cancellation and timeout supervise the whole child tree through TERM then KILL', async () => {
	for (const reason of ['cancelled', 'timeout'] as const) {
		const kills: NodeJS.Signals[] = [];
		const controller = new AbortController();
		const detector = createExternalFfmpegShotDetector({
			pair: pair(), workingDirectory: WORKING_DIRECTORY, digestExecutable: exactDigest,
			limits: {
				durationMs: reason === 'timeout' ? 1 : 5_000,
				stderrBytes: 4_096, metadataBytes: 8_192,
				terminationGraceMs: 1, killWaitMs: 1,
			},
			spawn: () => {
				const child = fakeChild(kills);
				if (reason === 'cancelled') queueMicrotask(() => controller.abort(new Error('stop')));
				return child;
			},
		});
		const pending = detector.verify({ signal: controller.signal });
		await rejectsReason(pending, reason);
		assert.deepEqual(kills, ['SIGTERM', 'SIGKILL']);
	}
});

test('independently bounds stderr and scene metadata while the process is running', async () => {
	for (const [stream, reason] of [
		['stderr', 'stderr-limit'],
		['metadata', 'metadata-limit'],
	] as const) {
		const kills: NodeJS.Signals[] = [];
		const detector = createExternalFfmpegShotDetector({
			pair: pair(), workingDirectory: WORKING_DIRECTORY, digestExecutable: exactDigest,
			limits: {
				durationMs: 5_000, stderrBytes: 64, metadataBytes: 64,
				terminationGraceMs: 1, killWaitMs: 1,
			},
			spawn: () => {
				const child = fakeChild(kills);
				queueMicrotask(() => (stream === 'stderr' ? child.stderr : child.metadata).write('x'.repeat(65)));
				return child;
			},
		});
		await rejectsReason(detector.verify(), reason);
		assert.deepEqual(kills, ['SIGTERM', 'SIGKILL']);
	}
});

test('reports nonzero exits and malformed successful metadata without claiming shots', async () => {
	const failed = createExternalFfmpegShotDetector({
		pair: pair(), workingDirectory: WORKING_DIRECTORY, digestExecutable: exactDigest,
		spawn: () => {
			const child = fakeChild();
			queueMicrotask(() => child.emit('close', 7, null));
			return child;
		},
	});
	await rejectsReason(failed.verify(), 'process-failed');

	const malformed = createExternalFfmpegShotDetector({
		pair: pair(), workingDirectory: WORKING_DIRECTORY, digestExecutable: exactDigest,
		spawn: outputSpawn('[showinfo] config in time_base: 1/1000, frame_rate: 25/1\n', 'not metadata\n'),
	});
	await rejectsReason(malformed.verify(), 'metadata-invalid');
});

interface Launch {
	readonly executable: string;
	readonly arguments_: readonly string[];
	readonly options: ExternalFfmpegShotLaunchOptions;
}

function pair() {
	return Object.freeze({
		executablePath: FFMPEG, ffmpegSha256: HASH_A,
		ffprobePath: FFPROBE, ffprobeSha256: HASH_B,
		executablePairClosureSha256: externalFfmpegExecutablePairClosureSha256({
			ffmpegPath: FFMPEG, ffmpegSha256: HASH_A,
			ffprobePath: FFPROBE, ffprobeSha256: HASH_B,
		}),
	});
}

async function exactDigest(path: string): Promise<string> {
	return path === FFMPEG ? HASH_A : HASH_B;
}

function successfulSpawn(launches: Launch[]): ExternalFfmpegShotSpawn {
	return (executable, arguments_, options) => {
		launches.push({ executable, arguments_, options });
		return arguments_.includes('-filter_complex')
			? completedOutput(canaryStderr(), metadataFrames([0, 1_000_000, 2_000_000, 3_000_000], 2))
			: completedOutput(
				'[showinfo] config in time_base: 1/90000, frame_rate: 30000/1001\n',
				metadataFrames([9_009, 12_012, 15_015], 2, 42.5),
			);
	};
}

function outputSpawn(stderr: string, metadata: string): ExternalFfmpegShotSpawn {
	return () => completedOutput(stderr, metadata);
}

function completedOutput(stderr: string, metadata: string): FakeChild {
	const child = fakeChild();
	queueMicrotask(() => {
		child.stderr.write(stderr);
		child.metadata.write(metadata);
		child.emit('close', 0, null);
	});
	return child;
}

function canaryStderr(): string {
	return '[showinfo] config in time_base: 1/1000000, frame_rate: 1/1\n';
}

function metadataFrames(
	pts: readonly number[],
	boundaryFrame?: number,
	boundaryScore = 100,
): string {
	return `${pts.flatMap((value, frame) => [
		`frame:${String(frame)} pts:${String(value)} pts_time:${String(value / 1_000_000)}`,
		`lavfi.scd.score=${frame === boundaryFrame ? boundaryScore.toFixed(3) : '0.000'}`,
		...(frame === boundaryFrame ? [`lavfi.scd.time=${String(value / 1_000_000)}`] : []),
	]).join('\n')}\n`;
}

type FakeChild = ExternalFfmpegShotChildProcess & EventEmitter & Readonly<{
	stderr: PassThrough;
	metadata: PassThrough;
}>;

function fakeChild(kills: NodeJS.Signals[] = []): FakeChild {
	const stderr = new PassThrough();
	const metadata = new PassThrough();
	return Object.assign(new EventEmitter(), {
		stderr, metadata, stdio: [null, null, stderr, null, metadata],
		kill: (signal: NodeJS.Signals) => { kills.push(signal); return true; },
	}) as unknown as FakeChild;
}

async function rejectsReason(
	operation: Promise<unknown>,
	reason: ExternalFfmpegShotDetectorError['reason'],
): Promise<void> {
	await assert.rejects(operation, (error: unknown) => (
		error instanceof ExternalFfmpegShotDetectorError && error.reason === reason
	));
}

function canaryArguments(): readonly string[] {
	return [
		'-nostdin', '-hide_banner', '-nostats', '-loglevel', 'info', '-xerror',
		'-protocol_whitelist', 'file,pipe,crypto,data',
		'-f', 'lavfi', '-i', 'color=c=black:s=16x16:r=1:d=2',
		'-f', 'lavfi', '-i', 'color=c=white:s=16x16:r=1:d=2',
		'-filter_complex', `[0:v:0][1:v:0]concat=n=2:v=1:a=0,${SCENE_FILTER}[shots]`,
		'-map', '[shots]', '-an', '-sn', '-dn', '-fps_mode', 'passthrough',
		'-f', 'null', '-',
	];
}

function detectionArguments(): readonly string[] {
	return [
		'-nostdin', '-hide_banner', '-nostats', '-loglevel', 'info', '-xerror',
		'-protocol_whitelist', 'file,pipe,crypto,data',
		'-noautorotate', '-i', SOURCE,
		'-map', '0:v:0', '-an', '-sn', '-dn', '-vf', SCENE_FILTER,
		'-fps_mode', 'passthrough', '-f', 'null', '-',
	];
}

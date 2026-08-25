/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import test from 'node:test';

import { externalFfmpegExecutablePairClosureSha256 } from '../desktop/external-ffmpeg-node-runtime.ts';
import type {
	ExternalFfmpegVideoCanaryInspector,
	ExternalFfmpegVideoCanaryInspectionRequest,
} from '../desktop/external-ffmpeg-video-canary-inspection.ts';
import {
	ExternalFfmpegVideoQualificationIdentityError,
	qualifyExternalFfmpegVideoAdmission,
} from '../desktop/external-ffmpeg-video-qualification.ts';
import type {
	ExternalFfmpegVideoChildProcess,
	ExternalFfmpegVideoSpawn,
} from '../desktop/external-ffmpeg-video-process.ts';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

test('qualification executes exact shell-free A/V plans and cleans private output', async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-video-qualification-'));
	const launches: Array<Readonly<{
		arguments_: readonly string[];
		options: Readonly<{ shell: false }>;
		video: Buffer[];
		audio: Buffer[];
	}>> = [];
	const inspections: ExternalFfmpegVideoCanaryInspectionRequest[] = [];
	const spawn: ExternalFfmpegVideoSpawn = (_executable, arguments_, options) => {
		const video: Buffer[] = [];
		const audio: Buffer[] = [];
		const child = fakeChild(capturingWritable(video), capturingWritable(audio));
		launches.push({ arguments_, options, video, audio });
		let finished = 0;
		const finish = (): void => {
			finished += 1;
			if (finished !== 2) return;
			const output = String(arguments_.at(-1));
			const bytes = arguments_.includes('libx264') ? validMp4() : validWebm();
			void writeFile(output, bytes).then(() => child.emit('close', 0, null));
		};
		(child.stdio[3] as Writable).once('finish', finish);
		(child.stdio[4] as Writable).once('finish', finish);
		return child;
	};
	try {
		const result = await qualifyExternalFfmpegVideoAdmission({
			scratchRoot: root, admission: admission(), spawn, environment: {},
			digestExecutable: exactDigest,
			inspectOutput: async (request) => { inspections.push(request); },
		});
		assert.equal(result.formats.mp4.available, true);
		assert.equal(result.formats.webm.available, true);
		assert.equal(launches.length, 2);
		for (const launch of launches) {
			assert.equal(launch.options.shell, false);
			assert.ok(launch.arguments_.includes('pipe:3'));
			assert.ok(launch.arguments_.includes('pipe:4'));
			assert.ok(launch.arguments_.includes('-fs'));
			assert.equal(Buffer.concat(launch.video).byteLength, 16 * 16 * 4);
			assert.equal(Buffer.concat(launch.audio).byteLength, 52);
		}
		assert.deepEqual(inspections.map((request) => Object.freeze({
			format: request.format,
			ffprobePath: request.ffprobePath,
			outputName: request.outputPath.split('/').at(-1),
			privateOutput: request.outputPath.startsWith(`${request.workingDirectory}/`),
		})), [
			{ format: 'mp4', ffprobePath: '/opt/ffprobe', outputName: 'canary.mp4', privateOutput: true },
			{ format: 'webm', ffprobePath: '/opt/ffprobe', outputName: 'canary.webm', privateOutput: true },
		]);
		assert.deepEqual(await readdir(root), []);
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('qualification fails only the exact format whose execution output is malformed', async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-video-qualification-partial-'));
	const spawn: ExternalFfmpegVideoSpawn = (_executable, arguments_) => {
		const child = fakeChild(new PassThrough(), new PassThrough());
		let finished = 0;
		const finish = (): void => {
			finished += 1;
			if (finished !== 2) return;
			const bytes = arguments_.includes('libx264') ? validMp4() : Uint8Array.of(1, 2, 3);
			void writeFile(String(arguments_.at(-1)), bytes).then(() => child.emit('close', 0, null));
		};
		(child.stdio[3] as Writable).once('finish', finish);
		(child.stdio[4] as Writable).once('finish', finish);
		return child;
	};
	try {
		const result = await qualifyExternalFfmpegVideoAdmission({
			scratchRoot: root, admission: admission(), spawn, environment: {},
			digestExecutable: exactDigest, inspectOutput: acceptInspection,
		});
		assert.equal(result.formats.mp4.available, true);
		assert.equal(result.formats.webm.available, false);
		assert.match(result.formats.webm.reason ?? '', /execution qualification/iu);
		assert.deepEqual(await readdir(root), []);
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('qualification rejects executable identity drift instead of advertising stale output', async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-video-qualification-identity-'));
	let digests = 0;
	try {
		await assert.rejects(() => qualifyExternalFfmpegVideoAdmission({
			scratchRoot: root, admission: admission({ webm: false }), environment: {},
			inspectOutput: acceptInspection,
			spawn: (_executable, arguments_) => {
				const child = fakeChild(new PassThrough(), new PassThrough());
				let finished = 0;
				const finish = (): void => {
					finished += 1;
					if (finished !== 2) return;
					void writeFile(String(arguments_.at(-1)), validMp4()).then(() => child.emit('close', 0, null));
				};
				(child.stdio[3] as Writable).once('finish', finish);
				(child.stdio[4] as Writable).once('finish', finish);
				return child;
			},
			digestExecutable: async (path) => {
				digests += 1;
				return digests <= 2 ? exactDigest(path) : 'c'.repeat(64);
			},
		}), (error: unknown) => error instanceof ExternalFfmpegVideoQualificationIdentityError);
		assert.deepEqual(await readdir(root), []);
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('qualification rejects an oversized canary output within its private bound', async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-video-qualification-output-limit-'));
	try {
		const result = await qualifyExternalFfmpegVideoAdmission({
			scratchRoot: root, admission: admission({ webm: false }), environment: {},
			digestExecutable: exactDigest, inspectOutput: acceptInspection,
			spawn: (_executable, arguments_) => {
				const child = fakeChild(new PassThrough(), new PassThrough());
				let finished = 0;
				const finish = (): void => {
					finished += 1;
					if (finished !== 2) return;
					void writeFile(String(arguments_.at(-1)), new Uint8Array(256 * 1024 + 1))
						.then(() => child.emit('close', 0, null));
				};
				(child.stdio[3] as Writable).once('finish', finish);
				(child.stdio[4] as Writable).once('finish', finish);
				return child;
			},
		});
		assert.equal(result.formats.mp4.available, false);
		assert.match(result.formats.mp4.reason ?? '', /execution qualification/iu);
		assert.deepEqual(await readdir(root), []);
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('qualification refuses a finite container when exact track inspection fails', async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-video-qualification-tracks-'));
	try {
		const result = await qualifyExternalFfmpegVideoAdmission({
			scratchRoot: root, admission: admission({ webm: false }), environment: {},
			digestExecutable: exactDigest,
			inspectOutput: async () => { throw new Error('wrong codec tuple'); },
			spawn: finiteOutputSpawn(validMp4()),
		});
		assert.equal(result.formats.mp4.available, false);
		assert.match(result.formats.mp4.reason ?? '', /execution qualification/iu);
		assert.deepEqual(await readdir(root), []);
	} finally { await rm(root, { recursive: true, force: true }); }
});

function admission(options: Readonly<{ webm?: boolean }> = {}) {
	return Object.freeze({
		executablePath: '/opt/ffmpeg', version: '8.0.0', capabilityGeneration: HASH_A,
		identity: Object.freeze({
			version: '8.0.0', ffmpegSha256: HASH_A, ffprobePath: '/opt/ffprobe',
			ffprobeSha256: HASH_B,
			executablePairClosureSha256: externalFfmpegExecutablePairClosureSha256({
				ffmpegPath: '/opt/ffmpeg', ffmpegSha256: HASH_A,
				ffprobePath: '/opt/ffprobe', ffprobeSha256: HASH_B,
			}),
		}),
		capabilities: Object.freeze({
			encoders: options.webm === false
				? ['libx264', 'aac'] : ['libx264', 'aac', 'libvpx-vp9', 'libopus'],
			decoders: ['rawvideo', 'pcm_f32le'],
			muxers: options.webm === false ? ['mp4'] : ['mp4', 'webm'],
			demuxers: ['rawvideo', 'wav'], filters: ['apad'],
		}),
	});
}

async function exactDigest(path: string): Promise<string> {
	return path.endsWith('ffmpeg') ? HASH_A : HASH_B;
}

function capturingWritable(chunks: Buffer[]): Writable {
	return new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
}

const acceptInspection: ExternalFfmpegVideoCanaryInspector = async () => undefined;

function finiteOutputSpawn(bytes: Uint8Array): ExternalFfmpegVideoSpawn {
	return (_executable, arguments_) => {
		const child = fakeChild(new PassThrough(), new PassThrough());
		let finished = 0;
		const finish = (): void => {
			finished += 1;
			if (finished !== 2) return;
			void writeFile(String(arguments_.at(-1)), bytes).then(() => child.emit('close', 0, null));
		};
		(child.stdio[3] as Writable).once('finish', finish);
		(child.stdio[4] as Writable).once('finish', finish);
		return child;
	};
}

type FakeChild = ExternalFfmpegVideoChildProcess & EventEmitter & Readonly<{
	stdio: [null, PassThrough, PassThrough, Writable, Writable];
}>;

function fakeChild(video: Writable, audio: Writable): FakeChild {
	const stdout = new PassThrough();
	const stderr = new PassThrough();
	return Object.assign(new EventEmitter(), {
		pid: 12_345, stdout, stderr, stdio: [null, stdout, stderr, video, audio],
		kill: () => true,
	}) as unknown as FakeChild;
}

function validMp4(): Uint8Array {
	return Uint8Array.from([
		0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0,
		0, 0, 0, 9, 0x6d, 0x6f, 0x6f, 0x76, 0,
		0, 0, 0, 9, 0x6d, 0x64, 0x61, 0x74, 0,
	]);
}

function validWebm(): Uint8Array {
	return Uint8Array.from([
		0x1a, 0x45, 0xdf, 0xa3, 0x87, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d,
		0x18, 0x53, 0x80, 0x67, 0x8c,
		0x16, 0x54, 0xae, 0x6b, 0x81, 0,
		0x1f, 0x43, 0xb6, 0x75, 0x81, 0,
	]);
}

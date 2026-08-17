/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
	buildVideoRemuxArgs,
	videoRemuxElementaryFormat,
} from '../src/common/editor/video-remux-ffmpeg.ts';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const CORE_JS = join(ROOT, 'node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js');
const CORE_WASM = join(ROOT, 'node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm');

interface LoadedCore {
	exec(...args: string[]): number;
	setLogger(logger: (entry: Readonly<{ type: string; message: string }>) => void): void;
	FS: { writeFile(name: string, bytes: Uint8Array): void; readFile(name: string): Uint8Array };
}

async function loadPinnedCore(): Promise<LoadedCore> {
	(globalThis as { self?: unknown }).self ??= globalThis;
	(globalThis as { location?: unknown }).location ??= new URL(pathToFileURL(CORE_JS).href);
	const wasmBinary = await readFile(CORE_WASM);
	const module = await import(pathToFileURL(CORE_JS).href) as {
		default: (options: object) => Promise<LoadedCore>;
	};
	return module.default({ wasmBinary });
}

const WIDTH = 320;
const HEIGHT = 180;
const FRAMES = 30;

function syntheticRgba(): Uint8Array {
	const frameBytes = WIDTH * HEIGHT * 4;
	const all = new Uint8Array(frameBytes * FRAMES);
	for (let frame = 0; frame < FRAMES; frame += 1) {
		for (let y = 0; y < HEIGHT; y += 1) {
			for (let x = 0; x < WIDTH; x += 1) {
				const index = frame * frameBytes + (y * WIDTH + x) * 4;
				all[index] = (x + frame * 3) & 0xff;
				all[index + 1] = (y + frame * 5) & 0xff;
				all[index + 2] = (x ^ y) & 0xff;
				all[index + 3] = 0xff;
			}
		}
	}
	return all;
}

test('the exact rational rate reaches FFmpeg as a quotient, never a decimal', () => {
	const args = buildVideoRemuxArgs({
		format: 'mp4',
		frameRate: { num: 30_000, den: 1_001 },
		videoInputPath: 'in.h264',
		outputPath: 'out.mp4',
	});
	assert.ok(args.includes('30000/1001'), 'the rate must survive as a quotient');
	assert.ok(!args.some((value) => /\d\.\d/u.test(value)), 'no argument may carry a decimal rate');
});

test('a remux copies the video stream and never re-encodes it', () => {
	const args = buildVideoRemuxArgs({
		format: 'mp4', frameRate: { num: 24, den: 1 },
		videoInputPath: 'in.h264', outputPath: 'out.mp4',
	});
	const codecIndex = args.indexOf('-c:v');
	assert.equal(args[codecIndex + 1], 'copy');
	assert.ok(!args.includes('libx264'), 'a remux that re-encodes is not a remux');
	assert.ok(args.includes('-an'), 'no audio input means no audio stream');
	assert.ok(args.includes('+faststart'), 'mp4 keeps the faststart parity of the encode path');
});

test('parity with the encode path: metadata, subtitle, and data streams stay stripped', () => {
	const args = buildVideoRemuxArgs({
		format: 'webm', frameRate: { num: 25, den: 1 },
		videoInputPath: 'in.ivf', audioInputPath: 'mix.wav', outputPath: 'out.webm',
	});
	for (const flag of ['-map_metadata', '-map_chapters', '-sn', '-dn']) {
		assert.ok(args.includes(flag), `${flag} must match the encode path`);
	}
	assert.ok(args.includes('libopus'), 'audio stays on the ordinary encoder');
	assert.ok(!args.includes('+faststart'), 'faststart is an mp4 concern only');
});

test('each format declares the elementary container its chunks need', () => {
	assert.equal(videoRemuxElementaryFormat('mp4'), 'h264');
	assert.equal(videoRemuxElementaryFormat('webm'), 'ivf');
});

test('malformed rates and paths are refused', () => {
	const base = { format: 'mp4', videoInputPath: 'in.h264', outputPath: 'out.mp4' } as const;
	assert.throws(() => buildVideoRemuxArgs({ ...base, frameRate: { num: 30, den: 0 } }), /exact rational frame rate/u);
	assert.throws(() => buildVideoRemuxArgs({ ...base, frameRate: { num: 29.97, den: 1 } }), /exact rational frame rate/u);
	assert.throws(
		() => buildVideoRemuxArgs({ ...base, frameRate: { num: 30, den: 1 }, videoInputPath: '' }),
		/video input path is required/u,
	);
});

/**
 * The capability this whole tier rests on: the shipped core can mux an already
 * encoded stream without touching the pixels. Measured rather than assumed,
 * because nothing in the product used `-c copy` before this.
 */
test('the pinned FFmpeg core remuxes a pre-encoded stream, and muxing is a rounding error', async () => {
	const core = await loadPinnedCore();
	core.setLogger(() => undefined);
	core.FS.writeFile('raw.rgba', syntheticRgba());

	const encodeStarted = process.hrtime.bigint();
	assert.equal(core.exec(
		'-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${WIDTH}x${HEIGHT}`, '-r', '30', '-i', 'raw.rgba',
		'-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-an', '-f', 'mp4', '-y', 'encoded.mp4',
	), 0, 'the fixture must encode');
	const encodeMs = Number(process.hrtime.bigint() - encodeStarted) / 1e6;

	// Stand in for WebCodecs output: an already-compressed elementary stream.
	assert.equal(core.exec(
		'-i', 'encoded.mp4', '-map', '0:v:0', '-c:v', 'copy',
		'-bsf:v', 'h264_mp4toannexb', '-f', 'h264', '-y', 'chunks.h264',
	), 0, 'the h264_mp4toannexb bitstream filter must exist in the shipped build');
	const elementary = core.FS.readFile('chunks.h264');
	assert.ok(elementary.byteLength > 0);

	const remuxStarted = process.hrtime.bigint();
	assert.equal(core.exec(...buildVideoRemuxArgs({
		format: 'mp4',
		frameRate: { num: 30, den: 1 },
		videoInputPath: 'chunks.h264',
		outputPath: 'remuxed.mp4',
	})), 0, 'the shipped core must remux a pre-encoded stream with -c copy');
	const remuxMs = Number(process.hrtime.bigint() - remuxStarted) / 1e6;

	const remuxed = core.FS.readFile('remuxed.mp4');
	assert.ok(remuxed.byteLength > 0, 'the remux must produce a container');
	assert.ok(
		remuxed.byteLength < elementary.byteLength * 3,
		'a remux repackages the stream rather than growing it into raw frames',
	);
	assert.ok(
		remuxMs < encodeMs,
		`muxing (${remuxMs.toFixed(1)} ms) must cost less than encoding (${encodeMs.toFixed(1)} ms)`,
	);
});

test('the pinned core also muxes a pre-encoded stream into the Matroska family', async () => {
	const core = await loadPinnedCore();
	core.setLogger(() => undefined);
	core.FS.writeFile('raw.rgba', syntheticRgba());
	assert.equal(core.exec(
		'-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${WIDTH}x${HEIGHT}`, '-r', '30', '-i', 'raw.rgba',
		'-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-an', '-f', 'mp4', '-y', 'a.mp4',
	), 0);
	assert.equal(core.exec(
		'-i', 'a.mp4', '-c:v', 'copy', '-bsf:v', 'h264_mp4toannexb', '-f', 'h264', '-y', 'a.h264',
	), 0);
	assert.equal(core.exec(
		'-f', 'h264', '-r', '30', '-i', 'a.h264', '-c:v', 'copy', '-f', 'matroska', '-y', 'a.mkv',
	), 0, 'the WebM/Matroska muxer must accept a copied stream');
	assert.ok(core.FS.readFile('a.mkv').byteLength > 0);
});

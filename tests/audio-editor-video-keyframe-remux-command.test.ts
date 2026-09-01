/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { admitVideoKeyframeEncoderWorkload } from '../src/common/editor/video-keyframe-encoder-admission.ts';
import { createVideoKeyframeExportFrameSource } from '../src/common/editor/video-keyframe-export-frame-source.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { createFramescaperProjectRetime } from '../src/framescaper/editor-project-retime.ts';
import { FRAMESCAPER_RETIME_PROJECT_MODEL_PROFILE } from '../src/framescaper/editor-project-retime-profile.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

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

/** A frame source shaped only for the admission that builds the command. */
function remuxFrameSource(frameRate: Readonly<{ num: number; den: number }>) {
	const project = createFramescaperProjectRetime(
		FRAMESCAPER_RETIME_PROJECT_MODEL_PROFILE,
		framescaperV20Options(),
	);
	const compatible = structuredClone(project) as Record<string, unknown>;
	compatible.schemaVersion = 17;
	return createVideoKeyframeExportFrameSource({
		project: resolveRuntimeProjectProjection(compatible),
		canvas: { width: WIDTH, height: HEIGHT, frameRate },
		startFrame: 0,
		endFrame: 48_000,
	});
}

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

/**
 * The command the shipped WebCodecs tier actually runs.
 *
 * It is built by the encoder admission, beside the raw-frame tier's command, so
 * the two can only differ in how the picture arrived. This file used to assert
 * against a second builder that nothing imported — it disagreed with the shipped
 * one about the audio bit rate, and any regression in the real command was
 * invisible to it.
 */
function remuxArguments(format: 'mp4' | 'webm', frameRate: Readonly<{ num: number; den: number }>) {
	return admitVideoKeyframeEncoderWorkload({
		frameSource: remuxFrameSource(frameRate),
		format,
		videoEncoder: 'webcodecs',
		inputPath: format === 'mp4' ? '/chunks.h264' : '/chunks.ivf',
		outputPath: `/remuxed.${format}`,
	}).ffmpegArguments;
}

test('the exact rational rate reaches FFmpeg as a quotient, never a decimal', () => {
	const args = remuxArguments('mp4', { num: 30_000, den: 1_001 });

	assert.deepEqual(args.slice(args.indexOf('-r'), args.indexOf('-r') + 2), ['-r', '30000/1001']);
	assert.equal(args.includes('29.97'), false, 'the decimal is what this tier may not trade for speed');
});

test('a remux copies the video stream and never re-encodes it', () => {
	const args = remuxArguments('mp4', { num: 30, den: 1 });

	assert.deepEqual(args.slice(args.indexOf('-c:v'), args.indexOf('-c:v') + 2), ['-c:v', 'copy']);
	assert.deepEqual(args.slice(0, 6), ['-nostdin', '-y', '-f', 'h264', '-r', '30/1']);
});

test('parity with the encode path: metadata, subtitle, and data streams stay stripped', () => {
	const remux = remuxArguments('mp4', { num: 30, den: 1 });
	const encode = admitVideoKeyframeEncoderWorkload({
		frameSource: remuxFrameSource({ num: 30, den: 1 }),
		format: 'mp4',
		inputPath: '/frames.rgba',
		outputPath: '/encoded.mp4',
	}).ffmpegArguments;

	for (const shared of ['-map_metadata', '-map_chapters', '-sn', '-dn', '-movflags', '+faststart']) {
		assert.ok(remux.includes(shared) && encode.includes(shared), shared);
	}
});

test('each format declares the elementary container its chunks need', () => {
	assert.equal(remuxArguments('mp4', { num: 30, den: 1 })[3], 'h264');
	assert.equal(remuxArguments('webm', { num: 30, den: 1 })[3], 'ivf');
});

/**
 * The capability this whole tier rests on: the shipped core can mux an already
 * encoded stream without touching the pixels. Nothing in the product used
 * `-c copy` before this, so exercise the pinned implementation directly.
 */
test('the pinned FFmpeg core remuxes a pre-encoded stream without re-encoding', async () => {
	const core = await loadPinnedCore();
	core.setLogger(() => undefined);
	core.FS.writeFile('raw.rgba', syntheticRgba());

	assert.equal(core.exec(
		'-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${WIDTH}x${HEIGHT}`, '-r', '30', '-i', 'raw.rgba',
		'-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-an', '-f', 'mp4', '-y', 'encoded.mp4',
	), 0, 'the fixture must encode');

	// Stand in for WebCodecs output: an already-compressed elementary stream.
	assert.equal(core.exec(
		'-i', 'encoded.mp4', '-map', '0:v:0', '-c:v', 'copy',
		'-bsf:v', 'h264_mp4toannexb', '-f', 'h264', '-y', 'chunks.h264',
	), 0, 'the h264_mp4toannexb bitstream filter must exist in the shipped build');
	const elementary = core.FS.readFile('chunks.h264');
	assert.ok(elementary.byteLength > 0);

	assert.equal(core.exec(...remuxArguments('mp4', { num: 30, den: 1 })
		.map((argument) => argument.replace(/^\//u, ''))), 0,
	'the shipped core must remux a pre-encoded stream with -c copy');

	const remuxed = core.FS.readFile('remuxed.mp4');
	assert.ok(remuxed.byteLength > 0, 'the remux must produce a container');
	assert.ok(
		remuxed.byteLength < elementary.byteLength * 3,
		'a remux repackages the stream rather than growing it into raw frames',
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

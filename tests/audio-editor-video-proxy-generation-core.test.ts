/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
	buildFfmpegVideoTimingProbeArgs,
	parseFfmpegVideoTimingLogs,
} from '../src/common/editor/ffmpeg-video-timing-probe.ts';
import { buildVideoProxyGenerationArgs } from '../src/common/editor/video-proxy-generation.ts';
import { videoBoundaryTime, type VideoSourceTimingView } from '../src/common/editor/video-source-timing-view.ts';
import {
	createVideoTimingAssetPublication,
	validateVideoTimingAssetBytes,
} from '../src/common/editor/video-timing-asset.ts';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const CORE_JS = join(ROOT, 'node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js');
const CORE_WASM = join(ROOT, 'node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm');

const WIDTH = 160;
const HEIGHT = 120;
const FRAMES = 12;
const RATE = Object.freeze({ num: 30_000, den: 1_001 });

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

function syntheticRgba(): Uint8Array {
	const frameBytes = WIDTH * HEIGHT * 4;
	const all = new Uint8Array(frameBytes * FRAMES);
	for (let frame = 0; frame < FRAMES; frame += 1) {
		for (let y = 0; y < HEIGHT; y += 1) {
			for (let x = 0; x < WIDTH; x += 1) {
				const index = frame * frameBytes + (y * WIDTH + x) * 4;
				all[index] = (x * 2 + frame * 7) & 0xff;
				all[index + 1] = (y * 2 + frame * 5) & 0xff;
				all[index + 2] = (x ^ y ^ frame) & 0xff;
				all[index + 3] = 0xff;
			}
		}
	}
	return all;
}

/**
 * Probe one file in the loaded core exactly as the shipped timing probe does,
 * and carry the result through the shipped asset encoding into the same timing
 * view a source would be read with.
 */
function probeTimingView(core: LoadedCore, path: string, sourceSha256: string): VideoSourceTimingView {
	const logs: string[] = [];
	core.setLogger(({ message }) => {
		if (typeof message === 'string') logs.push(message);
	});
	const exitCode = core.exec(...buildFfmpegVideoTimingProbeArgs(path));
	core.setLogger(() => {});
	assert.equal(exitCode, 0, `probing ${path} failed`);
	const parsed = parseFfmpegVideoTimingLogs(logs);
	const publication = createVideoTimingAssetPublication(sourceSha256, {
		timescale: parsed.timescale,
		presentationTicks: parsed.presentationTicks,
		finalFrameDurationTicks: parsed.finalFrameDurationTicks,
	});
	const index = validateVideoTimingAssetBytes(publication.reference, publication.bytes);
	return Object.freeze({ kind: 'vfr', reference: publication.reference, index });
}

/**
 * The recipe's own conformance, measured rather than reasoned about.
 *
 * `proveVideoProxyTimingConformance` compares an original and its proxy boundary
 * by boundary and refuses a pair that disagrees anywhere. That check is only
 * worth anything if the recipe can actually satisfy it against the build that
 * ships, so this runs the real pinned core: it writes an NTSC-rate original,
 * generates a proxy from it with the shipped arguments, probes both with the
 * shipped probe, and compares every boundary as the exact rational the timing
 * view produces.
 */
test('the shipped proxy arguments produce a body that conforms to its original', async () => {
	const core = await loadPinnedCore();
	core.FS.writeFile('frames.raw', syntheticRgba());
	assert.equal(core.exec(
		'-hide_banner', '-nostdin', '-y',
		'-f', 'rawvideo', '-pix_fmt', 'rgba',
		'-s', `${String(WIDTH)}x${String(HEIGHT)}`,
		'-r', `${String(RATE.num)}/${String(RATE.den)}`,
		'-i', 'frames.raw',
		'-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20', '-pix_fmt', 'yuv420p',
		'original.mp4',
	), 0, 'writing the original failed');

	assert.equal(
		core.exec(...buildVideoProxyGenerationArgs({
			inputPath: 'original.mp4', outputPath: 'proxy.mp4',
		})),
		0,
		'generating the proxy failed',
	);

	const original = probeTimingView(core, 'original.mp4', 'a'.repeat(64));
	const proxy = probeTimingView(core, 'proxy.mp4', 'b'.repeat(64));
	assert.ok(original.kind === 'vfr' && proxy.kind === 'vfr');

	// Frame for frame: the proxy presents exactly what the original did.
	assert.equal(original.index.frameCount, FRAMES);
	assert.equal(proxy.index.frameCount, original.index.frameCount);

	// And at exactly the same times. Reduced rationals, so the two files are free
	// to have landed on different timescales as long as the instants agree.
	for (let boundary = 0; boundary <= original.index.frameCount; boundary += 1) {
		const originalTime = videoBoundaryTime(original, boundary);
		const proxyTime = videoBoundaryTime(proxy, boundary);
		assert.equal(
			originalTime.numerator === proxyTime.numerator
				&& originalTime.denominator === proxyTime.denominator,
			true,
			`boundary ${String(boundary)}: ${String(originalTime.numerator)}/${String(originalTime.denominator)}`
				+ ` against ${String(proxyTime.numerator)}/${String(proxyTime.denominator)}`,
		);
	}

	// The proxy is a picture-only body: nothing here should have written a sound
	// stream the attachment then has to explain away.
	const bytes = core.FS.readFile('proxy.mp4');
	assert.ok(bytes.byteLength > 0);
	assert.ok(describe(core, 'proxy.mp4').every((line) => !line.includes('Audio:')));
});

/**
 * What a rotated original produces, which decides what the preview must do.
 *
 * Measured against this same build: `-noautorotate` copies the display matrix
 * onto the output, so a proxy written that way would declare a rotation the
 * preview applies a second time. The recipe therefore leaves autorotation on,
 * and this proves what that yields — a body whose coded frames are already in
 * display geometry and which carries no matrix for anyone to apply again.
 */
test('a rotated original yields a proxy that is already turned and declares nothing', async () => {
	const core = await loadPinnedCore();
	core.FS.writeFile('frames.raw', syntheticRgba());
	assert.equal(core.exec(
		'-hide_banner', '-nostdin', '-y',
		'-f', 'rawvideo', '-pix_fmt', 'rgba',
		'-s', `${String(WIDTH)}x${String(HEIGHT)}`,
		'-r', `${String(RATE.num)}/${String(RATE.den)}`,
		'-i', 'frames.raw',
		'-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20', '-pix_fmt', 'yuv420p',
		'upright.mp4',
	), 0, 'writing the upright original failed');
	assert.equal(core.exec(
		'-hide_banner', '-nostdin', '-y', '-i', 'upright.mp4',
		'-c', 'copy', '-metadata:s:v:0', 'rotate=90', 'turned.mp4',
	), 0, 'writing the rotated original failed');
	assert.ok(describe(core, 'turned.mp4').some((line) => line.includes('displaymatrix')));

	assert.equal(
		core.exec(...buildVideoProxyGenerationArgs({
			inputPath: 'turned.mp4', outputPath: 'turned-proxy.mp4',
		})),
		0,
		'generating the rotated proxy failed',
	);

	const described = describe(core, 'turned-proxy.mp4');
	assert.ok(
		described.every((line) => !line.includes('displaymatrix') && !line.includes('rotate')),
		described.join('\n'),
	);
	// The frames themselves carry the turn instead: a 160x120 source stored with
	// a quarter turn is a 120x160 picture, and that is the size the proxy is.
	const stream = described.find((line) => line.includes('Video:'));
	assert.ok(stream?.includes(`${String(HEIGHT)}x${String(WIDTH)}`), String(stream));
});

/** Everything the pinned build prints about one file. */
function describe(core: LoadedCore, path: string): readonly string[] {
	const logs: string[] = [];
	core.setLogger(({ message }) => {
		if (typeof message === 'string') logs.push(message);
	});
	core.exec('-hide_banner', '-nostdin', '-i', path, '-f', 'null', '-');
	// The logger stays installed after this returns, so it must keep writing
	// somewhere harmless rather than into the frozen answer.
	core.setLogger(() => {});
	return Object.freeze([...logs]);
}

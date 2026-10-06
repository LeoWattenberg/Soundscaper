/* SPDX-License-Identifier: AGPL-3.0-only */
// Audit-only helper CPU probes; these do not measure Electron or UI latency.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const repository = resolve(process.argv[2] ?? process.cwd());
const load = (path) => import(pathToFileURL(resolve(repository, path)).href);
const { writeInterleavedFloat32Pcm } = await load('src/common/editor/interleaved-float32-pcm.ts');
const { projectDesktopAudioDecodeResult } = await load('src/common/editor/desktop-audio-codec-result.ts');
const { crc32, unpackPlanarFloat32 } = await load('src/common/editor/wavpack/pcm.js');
assert.equal(new Uint8Array(Uint32Array.of(1).buffer)[0], 1, 'Sketch requires little-endian host');
const frames = 65_536, count = 8;
const channels = Array.from({ length: count }, () => new Float32Array(frames).fill(0.25));
const target = new Uint8Array(frames * count * 4);
// This sketch deliberately requires an aligned owned destination and validated planar input.
// Production work must keep geometry validation, destinationFrameOffset and endian fallback.
function alignedLittleEndianSketch(destination, planar, nonFinite = 'zero') {
	const out = new Float32Array(destination.buffer, destination.byteOffset, destination.byteLength / 4);
	const frameCount = planar[0].length, channelCount = planar.length;
	for (let frame = 0; frame < frameCount; frame++) {
		for (let channel = 0; channel < channelCount; channel++) {
			const sample = planar[channel][frame];
			out[frame * channelCount + channel] = nonFinite === 'zero' && !Number.isFinite(sample) ? 0 : sample;
		}
	}
}
const special = [0, -0, NaN, Infinity, -Infinity, 1, -1, Number.MIN_VALUE, 1e-40];
for (const mode of ['zero', 'preserve']) {
	const planar = [Float32Array.from(special), Float32Array.from([...special].reverse())];
	const expected = new Uint8Array(planar[0].length * 8), actual = new Uint8Array(expected.length);
	writeInterleavedFloat32Pcm(expected, planar, { nonFinite: mode });
	alignedLittleEndianSketch(actual, planar, mode);
	assert.deepEqual(actual, expected);
}
function rounded(value) { return Math.round(value * 100) / 100; }
function probe(fn, samples, repeat = 1) {
	const values = [];
	for (let sample = 0; sample < samples; sample++) {
		const started = performance.now();
		for (let iteration = 0; iteration < repeat; iteration++) fn();
		values.push(rounded((performance.now() - started) / repeat));
	}
	return values;
}
const report = {
	environment: { node: process.version, repository, platform: process.platform, architecture: process.arch },
	type: 'Isolated Node helper probe. No Electron, UI, I/O, actual export or integrated production change.',
	limitations: 'Shared host; uncontrolled GC. Sketch omits validated geometry and offset handling but preserves finite-to-zero and preserve modes in sample loop. No end-to-end gain claim.',
	sketchSampleParity: true,
	packet: { frames, channels: count, existingMs: probe(() => writeInterleavedFloat32Pcm(target, channels, { nonFinite: 'zero' }), 8, 20), sketchMs: probe(() => alignedLittleEndianSketch(target, channels), 8, 20) },
};
const longFrames = 48_000 * 60, longCount = 8;
const longPlanar = Array.from({ length: longCount }, () => new Float32Array(longFrames).fill(0.25));
const longBytes = new Uint8Array(longFrames * longCount * 4);
report.longPcm = {
	seconds: 60, sampleRate: 48_000, channels: longCount, bytes: longBytes.byteLength,
	interleaveMs: probe(() => writeInterleavedFloat32Pcm(longBytes, longPlanar, { nonFinite: 'zero' }), 6),
	deinterleaveMs: probe(() => projectDesktopAudioDecodeResult({ operation: 'audio-decode', bytes: longBytes, metadata: { channelCount: longCount, frameCount: longFrames, sampleRate: 48_000 } }), 6),
	crc32Ms: probe(() => crc32(longBytes), 6),
	unpackPacketMs: probe(() => unpackPlanarFloat32(new ArrayBuffer(frames * longCount * 4), frames, longCount), 6),
};
console.log(JSON.stringify(report, null, 2));

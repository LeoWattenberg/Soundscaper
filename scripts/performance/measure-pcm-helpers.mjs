/* SPDX-License-Identifier: AGPL-3.0-only */
// Helper CPU probes only; Electron interaction latency is measured separately.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const repository = resolve(process.argv[2] ?? process.cwd());
const baselineRevision = process.argv[3] ?? '25d7cbdb4';
const baselineCommit = execFileSync('git', ['-C', repository, 'rev-parse', `${baselineRevision}^{commit}`], { encoding: 'utf8' }).trim();
const loadCurrent = (path) => import(pathToFileURL(resolve(repository, path)).href);
function loadBaseline(path) {
	const source = execFileSync('git', ['-C', repository, 'show', `${baselineCommit}:${path}`], { encoding: 'utf8' });
	const javascript = path.endsWith('.ts') ? ts.transpileModule(source, {
		compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext }, fileName: path,
	}).outputText : source;
	return import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
}
const paths = ['src/common/editor/interleaved-float32-pcm.ts', 'src/common/editor/desktop-audio-codec-result.ts', 'src/common/editor/wavpack/pcm.js'];
const [currentInterleave, currentProjection, currentPcm, baselineInterleave, baselineProjection, baselinePcm] = await Promise.all([
	...paths.map(loadCurrent), ...paths.map(loadBaseline),
]);
const special = [0, -0, NaN, Infinity, -Infinity, 1, -1, Number.MIN_VALUE, 1e-40];
for (const nonFinite of ['zero', 'preserve']) {
	for (const offset of [0, 1, 4]) {
		const planar = [Float32Array.from(special), Float32Array.from([...special].reverse())];
		const expectedBacking = new Uint8Array(112).fill(0x5a), actualBacking = expectedBacking.slice();
		const expected = expectedBacking.subarray(offset, offset + 101), actual = actualBacking.subarray(offset, offset + 101);
		const options = { nonFinite, frameCount: planar[0].length, destinationFrameOffset: 2 };
		baselineInterleave.writeInterleavedFloat32Pcm(expected, planar, options);
		currentInterleave.writeInterleavedFloat32Pcm(actual, planar, options);
		assert.deepEqual(actualBacking, expectedBacking);
		const input = actual.subarray(16, 16 + planar[0].length * 8);
		const result = { operation: 'audio-decode', bytes: input, metadata: { sampleRate: 48_000, channelCount: 2, frameCount: planar[0].length } };
		assert.deepEqual(currentProjection.projectDesktopAudioDecodeResult(result), baselineProjection.projectDesktopAudioDecodeResult(result));
	}
}
function rounded(value) { return Math.round(value * 100) / 100; }
function probe(fn, samples = 7, repeat = 1) {
	for (let warmup = 0; warmup < 3; warmup++) fn();
	const values = [];
	for (let sample = 0; sample < samples; sample++) {
		const started = performance.now();
		for (let iteration = 0; iteration < repeat; iteration++) fn();
		values.push((performance.now() - started) / repeat);
	}
	const sorted = [...values].sort((a, b) => a - b);
	return { medianMs: rounded(sorted[Math.floor(sorted.length / 2)]), samplesMs: values.map(rounded), warmupIterations: 3, repeat };
}
const frames = 65_536, count = 8;
const channels = Array.from({ length: count }, () => new Float32Array(frames).fill(0.25));
const target = new Uint8Array(frames * count * 4);
const report = {
	environment: { node: process.version, repository, baselineCommit, platform: process.platform, architecture: process.arch },
	type: 'Isolated warmed Node CPU probes against the committed baseline. No Electron, UI, I/O or end-to-end export measurement.',
	limitations: 'Shared host and uncontrolled GC. Worker CRC dispatch and result custody are covered by regression tests, not this synchronous helper probe.',
	byteParity: { aligned: true, misaligned: true, nonFinite: ['zero', 'preserve'], destinationOffsetAndGuardBytes: true },
	packet: { frames, channels: count,
		baselineInterleave: probe(() => baselineInterleave.writeInterleavedFloat32Pcm(target, channels, { nonFinite: 'zero' }), 7, 20),
		currentInterleave: probe(() => currentInterleave.writeInterleavedFloat32Pcm(target, channels, { nonFinite: 'zero' }), 7, 20),
	},
};
const longFrames = 48_000 * 60, longCount = 8;
const longPlanar = Array.from({ length: longCount }, () => new Float32Array(longFrames).fill(0.25));
const longBytes = new Uint8Array(longFrames * longCount * 4);
const result = { operation: 'audio-decode', bytes: longBytes, metadata: { channelCount: longCount, frameCount: longFrames, sampleRate: 48_000 } };
const packed = new ArrayBuffer(frames * longCount * 4);
report.longPcm = {
	seconds: 60, sampleRate: 48_000, channels: longCount, bytes: longBytes.byteLength,
	baselineInterleave: probe(() => baselineInterleave.writeInterleavedFloat32Pcm(longBytes, longPlanar, { nonFinite: 'zero' })),
	currentInterleave: probe(() => currentInterleave.writeInterleavedFloat32Pcm(longBytes, longPlanar, { nonFinite: 'zero' })),
	baselineProjection: probe(() => baselineProjection.projectDesktopAudioDecodeResult(result)),
	currentProjection: probe(() => currentProjection.projectDesktopAudioDecodeResult(result)),
	baselineCrc32: probe(() => baselinePcm.crc32(longBytes)),
	currentCrc32: probe(() => currentPcm.crc32(longBytes)),
	baselineUnpackPacket: probe(() => baselinePcm.unpackPlanarFloat32(packed, frames, longCount)),
	currentUnpackPacket: probe(() => currentPcm.unpackPlanarFloat32(packed, frames, longCount)),
	privateOwnedUnpackPacket: probe(() => currentPcm.unpackOwnedPlanarFloat32(packed, frames, longCount)),
};
console.log(JSON.stringify(report, null, 2));

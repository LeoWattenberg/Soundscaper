/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { MOTION_SUSTAINED_PLAN, assessMotionSustainedMemory, type MotionSustainedMemorySample } from '../scripts/performance/motionscaper-sustained-plan.ts';
import { parseMotionProcessStat, parseMotionProcessMemory, selectMotionOwnedProcesses } from '../scripts/performance/motionscaper-sustained-process.ts';
import { MotionSustainedPcmOracle, inspectMotionSustainedNativeMetadata } from '../scripts/performance/motionscaper-sustained-oracle.ts';

const mib = 1024 * 1024;
const sample = (frame: number, bytes: number, time = frame * 100): MotionSustainedMemorySample => ({
	elapsedMs: time, completedFrames: frame, rssBytes: bytes + 10 * mib, pssBytes: bytes,
	isolateUsedHeapBytes: [12 * mib], isolateTotalHeapBytes: [24 * mib], wasmCapacityBytes: [32 * mib],
});
const observations = (frames: number, bytes = 100 * mib) => Array.from({ length: frames + 1 }, (_, frame) => sample(frame, bytes));

test('Motion sustained admission detects duration-proportional retention without confusing reserved WASM with live bytes', () => {
	const short = observations(300), long = observations(1200);
	const accepted = assessMotionSustainedMemory(short, long);
	assert.equal(accepted.pssTailGrowthBytes, 0);
	assert.equal(accepted.wasmCapacityGrowthBytes, 0);
	assert.equal(MOTION_SUSTAINED_PLAN.runs[1], 1200);
	assert.throws(() => assessMotionSustainedMemory(short, long.map(value => ({ ...value,
		pssBytes: value.pssBytes + value.completedFrames * 160 * 90 * 16,
		rssBytes: value.rssBytes + value.completedFrames * 160 * 90 * 16 }))), /PSS duration growth/u);
	assert.throws(() => assessMotionSustainedMemory(short, long.map(value => ({ ...value,
		wasmCapacityBytes: [80 * mib] }))), /WASM capacity growth/u);
	assert.throws(() => assessMotionSustainedMemory(short, long.map(value => ({ ...value,
		isolateUsedHeapBytes: [700 * mib], isolateTotalHeapBytes: [710 * mib] }))), /JS heap ceiling/u);
});

test('Motion sustained evidence refuses missing completion, sparse sampling and ambiguous memory measurements', () => {
	const short = observations(300), long = observations(1200);
	assert.throws(() => assessMotionSustainedMemory(short, long.slice(0, -1)), /completion/u);
	assert.throws(() => assessMotionSustainedMemory(short, [long[0]!, long.at(-1)!]), /sample cadence/u);
	assert.throws(() => assessMotionSustainedMemory(short, long.map(value => ({ ...value, pssBytes: NaN }))), /finite/u);
	assert.throws(() => assessMotionSustainedMemory(short, long.map(value => ({ ...value, wasmCapacityBytes: [] }))), /WASM observation/u);
	assert.throws(() => assessMotionSustainedMemory(short, long.map(value => ({ ...value, isolateTotalHeapBytes: [1] }))), /heap capacity/u);
});

function stat(pid: number, parent: number, start: number, name = 'motion (worker)') {
	return `${pid} (${name}) S ${parent} ${Array.from({ length: 17 }, () => '0').join(' ')} ${start} 0 0`;
}
test('Motion process ownership uses PID plus start ticks and handles parent exit without adopting a reused PID', () => {
	const root = parseMotionProcessStat(stat(20, 1, 100));
	const child = parseMotionProcessStat(stat(21, 20, 101));
	const unrelated = parseMotionProcessStat(stat(30, 1, 80));
	assert.equal(root.startTicks, '100'); assert.equal(root.parentPid, 1);
	const owned = selectMotionOwnedProcesses([root, child, unrelated], root, []);
	assert.deepEqual(owned.map(value => value.pid), [20, 21]);
	const orphan = { ...child, parentPid: 1 };
	assert.deepEqual(selectMotionOwnedProcesses([orphan, unrelated], root, owned), [orphan]);
	assert.deepEqual(selectMotionOwnedProcesses([{ ...child, startTicks: '200' }, unrelated], root, owned), []);
	assert.throws(() => parseMotionProcessStat('20 truncated'), /process stat/u);
	assert.deepEqual(parseMotionProcessMemory('Rss: 123 kB\nPss: 100 kB\nPss_Anon: 20 kB\n'), { rssBytes: 123 * 1024, pssBytes: 100 * 1024 });
	assert.throws(() => parseMotionProcessMemory('Rss: 123 kB\n'), /PSS/u);
});

test('Motion exact PCM oracle checks every native sample across arbitrarily split reads with bounded carry', () => {
	const bytes = new Uint8Array(16 * 8); const view = new DataView(bytes.buffer);
	for (let index = 0; index < 16; index++) {
		view.setFloat32(index * 8, (index % 127 - 63) / 128, true);
		view.setFloat32(index * 8 + 4, -(index % 127 - 63) / 128, true);
	}
	const oracle = new MotionSustainedPcmOracle(16);
	for (let offset = 0; offset < bytes.length; offset += 3) oracle.write(bytes.subarray(offset, offset + 3));
	assert.deepEqual(oracle.finish(), { samples: 16, channels: 2, sampleRate: 48000, exact: true });
	const corrupt = bytes.slice(); new DataView(corrupt.buffer).setFloat32(12, 0, true);
	assert.throws(() => new MotionSustainedPcmOracle(16).write(corrupt), /sample 1 channel 1/u);
	const truncated = new MotionSustainedPcmOracle(16); truncated.write(bytes.subarray(0, -1));
	assert.throws(() => truncated.finish(), /incomplete/u);
	assert.throws(() => new MotionSustainedPcmOracle(15).write(bytes), /sample admission/u);
});

test('Motion sustained native metadata requires all frame timestamps, full exact PCM and only three decoded pictures', () => {
	const metadata = { width: 160, height: 90, frameCount: 300, selectedFrames: [0, 150, 299],
		firstTimestamp: { num: 0, den: 30 }, lastTimestamp: { num: 299, den: 30 }, contiguousFrameTimes: true,
		profile: 4, colorDepth: 12, alphaDepth: 16, colorPrimaries: 1, colorTransfer: 1, colorSpace: 1,
		audio: { sampleRate: 48000, channels: 2, sampleCount: 480000, contiguous: true } };
	assert.deepEqual(inspectMotionSustainedNativeMetadata(metadata, 300, 3 * 160 * 90 * 16, 480000 * 8), metadata);
	assert.throws(() => inspectMotionSustainedNativeMetadata({ ...metadata, contiguousFrameTimes: false }, 300, 3 * 160 * 90 * 16, 480000 * 8), /timestamps/u);
	assert.throws(() => inspectMotionSustainedNativeMetadata({ ...metadata, selectedFrames: [0, 149, 299] }, 300, 3 * 160 * 90 * 16, 480000 * 8), /selected/u);
	assert.throws(() => inspectMotionSustainedNativeMetadata(metadata, 300, 300 * 160 * 90 * 16, 480000 * 8), /picture bytes/u);
	assert.throws(() => inspectMotionSustainedNativeMetadata(metadata, 300, 3 * 160 * 90 * 16, 480000 * 8 - 8), /PCM bytes/u);
});

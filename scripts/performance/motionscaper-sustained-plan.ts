/* SPDX-License-Identifier: AGPL-3.0-only */
/** Predeclared qualification policy, not a product maximum or a measured result. */
const MIB = 1024 * 1024;
export const MOTION_SUSTAINED_PLAN = Object.freeze({
	id: 'motion-browser-linux-duration-v1', width: 160, height: 90, fps: 30,
	runs: Object.freeze([300, 1200] as const), projectFrames: 1200, sampleRate: 48000, channels: 2,
	samplePeriodMs: 100, maximumSampleGapMs: 1000, telemetryPeriodMs: 1000,
	warmupFrames: 120, tailFrames: 60, maximumPhaseMs: 600000,
	maximumReadBytes: 65536, maximumSamples: 12000,
	maximumRssBytes: 2048 * MIB, maximumPssBytes: 1536 * MIB,
	maximumIsolateHeapBytes: 512 * MIB, maximumWasmCapacityBytes: 256 * MIB,
	maximumRssTailGrowthBytes: 128 * MIB, maximumPssTailGrowthBytes: 64 * MIB,
	maximumHeapTailGrowthBytes: 64 * MIB, maximumWasmTailGrowthBytes: 32 * MIB,
	maximumNativeHelperRssBytes: 384 * MIB, maximumNativeHelperPssBytes: 256 * MIB,
	maximumOwnedProcesses: 64, maximumTelemetryTargets: 32,
	maximumOutputBytes: 512 * MIB, maximumOutstandingWrites: 1,
	maximumPreviewPremultipliedError: 1, maximumNativeColorError: 8 / 1023,
	maximumNativeAlphaError: 2 / 1023, maximumWebmTimestampErrorSeconds: 0.001,
});

export interface MotionSustainedMemorySample {
	readonly elapsedMs: number; readonly completedFrames: number;
	readonly rssBytes: number; readonly pssBytes: number;
	/** CDP reports used/total JS heap; neither field is a native allocation count. */
	readonly isolateUsedHeapBytes: readonly number[]; readonly isolateTotalHeapBytes: readonly number[];
	/** Externally observed WebAssembly.Memory.buffer.byteLength; capacity, never live bytes. */
	readonly wasmCapacityBytes: readonly number[];
}
function fail(message: string): never { throw new Error(`Motion sustained qualification: ${message}`); }
function finite(value: number): void { if (!Number.isFinite(value) || value < 0) fail('memory/time observations must be finite and non-negative'); }
function sum(values: readonly number[]): number { return values.reduce((a, b) => a + b, 0); }
function median(values: readonly number[]): number {
	if (!values.length) fail('missing post-warmup tail observations');
	const sorted = [...values].sort((a, b) => a - b); const at = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[at]! : (sorted[at - 1]! + sorted[at]!) / 2;
}
function validate(samples: readonly MotionSustainedMemorySample[], frames: number): readonly MotionSustainedMemorySample[] {
	const plan = MOTION_SUSTAINED_PLAN;
	if (!samples.length || samples.length > plan.maximumSamples || samples[0]!.completedFrames !== 0
		|| samples.at(-1)!.completedFrames !== frames) fail('missing exact phase start/completion');
	let previousTime = 0, previousFrame = 0;
	for (const sample of samples) {
		for (const value of [sample.elapsedMs, sample.rssBytes, sample.pssBytes, ...sample.isolateUsedHeapBytes,
			...sample.isolateTotalHeapBytes, ...sample.wasmCapacityBytes]) finite(value);
		if (!Number.isSafeInteger(sample.completedFrames) || sample.completedFrames < previousFrame || sample.completedFrames > frames) fail('non-monotonic frame progress');
		if (sample.elapsedMs < previousTime || sample.elapsedMs - previousTime > plan.maximumSampleGapMs) fail('sample cadence exceeded');
		if (sample.elapsedMs > plan.maximumPhaseMs) fail('phase deadline exceeded');
		if (sample.rssBytes > plan.maximumRssBytes || sample.pssBytes > plan.maximumPssBytes) fail('owned process memory ceiling exceeded');
		if (sample.pssBytes > sample.rssBytes) fail('PSS exceeds RSS');
		if (sample.isolateUsedHeapBytes.length !== sample.isolateTotalHeapBytes.length || sample.isolateUsedHeapBytes.length > plan.maximumTelemetryTargets) fail('ambiguous JS isolate observations');
		if (sample.isolateUsedHeapBytes.some((value, index) => value > sample.isolateTotalHeapBytes[index]!)) fail('used JS heap exceeds heap capacity');
		if (sample.isolateUsedHeapBytes.some(value => value > plan.maximumIsolateHeapBytes)) fail('JS heap ceiling exceeded');
		if (sample.wasmCapacityBytes.length > plan.maximumTelemetryTargets || sample.wasmCapacityBytes.some(value => value > plan.maximumWasmCapacityBytes)) fail('WASM capacity ceiling exceeded');
		previousTime = sample.elapsedMs; previousFrame = sample.completedFrames;
	}
	const tail = samples.filter(sample => sample.completedFrames >= frames - plan.tailFrames);
	if (tail.length < 3) fail('sample cadence lacks three tail observations');
	if (tail.some(sample => !sample.wasmCapacityBytes.length)) fail('missing WASM observation in the measured tail');
	if (tail.some(sample => !sample.isolateUsedHeapBytes.length)) fail('missing JS isolate observation in the measured tail');
	return tail;
}
/** Compare like-for-like phase tails after the same 120-frame warmup, without forced GC. */
export function assessMotionSustainedMemory(short: readonly MotionSustainedMemorySample[], long: readonly MotionSustainedMemorySample[]) {
	const a = validate(short, 300), b = validate(long, 1200), plan = MOTION_SUSTAINED_PLAN;
	const growth = (read: (value: MotionSustainedMemorySample) => number) => median(b.map(read)) - median(a.map(read));
	const rssTailGrowthBytes = growth(value => value.rssBytes), pssTailGrowthBytes = growth(value => value.pssBytes);
	const heapTailGrowthBytes = growth(value => sum(value.isolateUsedHeapBytes));
	const wasmCapacityGrowthBytes = growth(value => sum(value.wasmCapacityBytes));
	if (pssTailGrowthBytes > plan.maximumPssTailGrowthBytes) fail('PSS duration growth exceeded 64 MiB');
	if (rssTailGrowthBytes > plan.maximumRssTailGrowthBytes) fail('RSS duration growth exceeded 128 MiB');
	if (heapTailGrowthBytes > plan.maximumHeapTailGrowthBytes) fail('JS heap duration growth exceeded 64 MiB');
	if (wasmCapacityGrowthBytes > plan.maximumWasmTailGrowthBytes) fail('WASM capacity growth exceeded 32 MiB');
	return Object.freeze({ rssTailGrowthBytes, pssTailGrowthBytes, heapTailGrowthBytes, wasmCapacityGrowthBytes });
}

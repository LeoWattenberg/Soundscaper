/* SPDX-License-Identifier: AGPL-3.0-only */
import { open } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { MOTION_SUSTAINED_PLAN as bounds } from '../scripts/performance/motionscaper-sustained-plan.ts';
import type { MotionSustainedMemorySample } from '../scripts/performance/motionscaper-sustained-plan.ts';
import { sampleMotionOwnedProcesses } from '../scripts/performance/motionscaper-sustained-observation.ts';
import type { launchMotionSustainedApplication } from '../scripts/performance/motionscaper-sustained-launch.ts';

/** The distinct 32,768-frame case has one continuous 1800s observation, retaining the existing
 * 100ms cadence, 1s maximum gap and absolute byte ceilings. The fixed 300/1200 policy is unchanged.
 */
export function inspectMotionMaximumMemory(value: MotionSustainedMemorySample, prior: MotionSustainedMemorySample | null, frames: number, deadline: number): void {
	if (!Number.isSafeInteger(value.completedFrames) || value.completedFrames < (prior?.completedFrames ?? 0) || value.completedFrames > frames) throw new Error('Maximum-workload progress changed or exceeded its range.');
	if (![value.elapsedMs, value.telemetryElapsedMs, value.rssBytes, value.pssBytes, ...value.isolateUsedHeapBytes, ...value.isolateTotalHeapBytes, ...value.wasmCapacityBytes].every(bytes => Number.isFinite(bytes) && bytes >= 0)) throw new Error('Maximum-workload memory evidence is not finite.');
	if (value.elapsedMs > deadline || value.elapsedMs < (prior?.elapsedMs ?? 0) || value.elapsedMs - (prior?.elapsedMs ?? 0) > bounds.maximumSampleGapMs
		|| value.telemetryElapsedMs > value.elapsedMs || value.elapsedMs - value.telemetryElapsedMs > bounds.maximumSampleGapMs) throw new Error('Maximum-workload observation deadline/cadence exceeded.');
	if (value.telemetrySequence !== (prior?.telemetrySequence ?? 0) + 1 || value.isolateUsedHeapBytes.length === 0 || value.isolateUsedHeapBytes.length !== value.isolateTotalHeapBytes.length
		|| value.isolateUsedHeapBytes.length > bounds.maximumTelemetryTargets || value.wasmCapacityBytes.length > bounds.maximumTelemetryTargets) throw new Error('Maximum-workload isolate evidence is missing or ambiguous.');
	if (value.rssBytes > bounds.maximumRssBytes || value.pssBytes > bounds.maximumPssBytes || value.pssBytes > value.rssBytes
		|| value.isolateUsedHeapBytes.some((bytes, index) => bytes > bounds.maximumIsolateHeapBytes || bytes > value.isolateTotalHeapBytes[index]!)
		|| value.wasmCapacityBytes.some(bytes => bytes > bounds.maximumWasmCapacityBytes)) throw new Error('Maximum-workload memory ceiling exceeded.');
}

/** Same retained-byte ceilings, comparing two windows within this one index workload.
 * This is not the separate 300-versus-1200 duration comparison.
 */
export function inspectMotionMaximumIndexRetention(warm: readonly MotionSustainedMemorySample[], tail: readonly MotionSustainedMemorySample[]) {
	if (warm.length < 3 || tail.length < 3 || [...warm, ...tail].some(value => value.wasmCapacityBytes.length === 0)) throw new Error('Maximum-index retention lacks three genuine warm/tail WASM observations.');
	const median = (values: readonly number[]) => { const sorted = [...values].sort((a, b) => a - b), at = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[at]! : (sorted[at - 1]! + sorted[at]!) / 2; };
	const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);
	const growth = (read: (value: MotionSustainedMemorySample) => number) => median(tail.map(read)) - median(warm.map(read));
	const rssGrowthBytes = growth(value => value.rssBytes), pssGrowthBytes = growth(value => value.pssBytes);
	const heapGrowthBytes = growth(value => sum(value.isolateUsedHeapBytes)), wasmGrowthBytes = growth(value => sum(value.wasmCapacityBytes));
	if (rssGrowthBytes > bounds.maximumRssTailGrowthBytes || pssGrowthBytes > bounds.maximumPssTailGrowthBytes
		|| heapGrowthBytes > bounds.maximumHeapTailGrowthBytes || wasmGrowthBytes > bounds.maximumWasmTailGrowthBytes) throw new Error('Maximum-index retained memory growth exceeds the existing byte ceilings.');
	return { rssGrowthBytes, pssGrowthBytes, heapGrowthBytes, wasmGrowthBytes };
}

export async function startMotionMaximumObservation(application: Awaited<ReturnType<typeof launchMotionSustainedApplication>>, options: Readonly<{
	logPath: string; frames: number; deadline: 600000 | 1800000; progress(): Promise<number>;
}>) {
	const output = await open(options.logPath, 'wx', 0o600), started = performance.now(), interrupt = new AbortController();
	let stopping = false, failure: unknown, prior: MotionSustainedMemorySample | null = null, count = 0;
	let previous: Parameters<typeof sampleMotionOwnedProcesses>[1] = [];
	const warm: MotionSustainedMemorySample[] = [], tail: MotionSustainedMemorySample[] = [];
	const targetFrames = new Map<string, number>();
	let peakRssBytes = 0, peakPssBytes = 0;
	let rejectFailure!: (error: unknown) => void;
	const failed = new Promise<never>((_, reject) => { rejectFailure = reject; }); void failed.catch(() => undefined);
	const sample = async () => {
		const memory = await sampleMotionOwnedProcesses(application.owner, previous);
		previous = memory.processes.map(value => value.identity); application.retainProcessIdentities(previous);
		if (!previous.some(value => value.pid === application.owner.pid && value.startTicks === application.owner.startTicks)) throw new Error('Maximum-workload application owner disappeared.');
		const [targets, completedFrames] = await Promise.all([application.cdp.sample(), options.progress()]);
		if (!targets.some(value => value.type === 'page')) throw new Error('Maximum-workload page telemetry is missing.');
		const now = performance.now(), value: MotionSustainedMemorySample = {
			elapsedMs: now - started, completedFrames, telemetrySequence: count + 1,
			telemetryElapsedMs: Math.max(0, Math.min(...targets.map(target => target.monotonicMs)) - started),
			rssBytes: memory.rssBytes, pssBytes: memory.pssBytes, isolateUsedHeapBytes: targets.map(target => target.usedHeapBytes),
			isolateTotalHeapBytes: targets.map(target => target.totalHeapBytes), wasmCapacityBytes: targets.flatMap(target => target.wasmCapacityBytes),
		};
		// Retain the exact refused operands as well as successful rows; refusal never becomes a sample.
		let refused: unknown;
		try {
			if (targets.some(target => now - target.monotonicMs > bounds.maximumSampleGapMs)) throw new Error('Maximum-workload target telemetry is stale.');
			if (targets.some(target => target.workerFrames < (targetFrames.get(target.sessionId) ?? 0))) throw new Error('Maximum-workload worker telemetry regressed.');
			if (count >= Math.ceil(options.deadline / bounds.samplePeriodMs) + 1) throw new Error('Maximum-workload observation count exceeded.');
			inspectMotionMaximumMemory(value, prior, options.frames, options.deadline);
		} catch (error) { refused = error; }
		await output.write(`${JSON.stringify({ memory, targets, summary: value, refusal: refused ? String(refused) : null })}\n`);
		if (refused) throw refused;
		for (const target of targets) targetFrames.set(target.sessionId, target.workerFrames);
		peakRssBytes = Math.max(peakRssBytes, value.rssBytes); peakPssBytes = Math.max(peakPssBytes, value.pssBytes);
		if (options.frames === 32768 && completedFrames >= 120 && completedFrames <= 180 && warm.length < 1024) warm.push(value);
		if (completedFrames >= options.frames - 60) { tail.push(value); if (tail.length > 1024) tail.shift(); }
		prior = value; count++;
	};
	try { await sample(); } catch (error) { await output.close(); throw error; }
	const task = (async () => {
		try {
			while (!stopping) {
				try { await delay(Math.max(1, bounds.samplePeriodMs - (performance.now() - started - prior!.elapsedMs)), undefined, { signal: interrupt.signal }); }
				catch (error) { if (stopping && interrupt.signal.aborted && error instanceof Error && error.name === 'AbortError') break; throw error; }
				if (!stopping) await sample();
			}
		} catch (error) { failure = error; rejectFailure(error); }
	})();
	let stopped: Promise<unknown> | undefined;
	const stop = async () => {
		stopping = true; interrupt.abort(); await task;
		try {
			if (failure) throw failure; await sample(); await output.sync();
			if (prior!.completedFrames !== options.frames || !tail.some(value => value.wasmCapacityBytes.length > 0)) throw new Error('Maximum-workload completion/WASM evidence is missing.');
			const retention = options.frames === 32768 ? inspectMotionMaximumIndexRetention(warm, tail) : null;
			return { count, peakRssBytes, peakPssBytes, warm, tail, retention, last: prior, logPath: options.logPath };
		} finally { await output.close(); }
	};
	return { failed, stop() { return stopped ??= stop(); } };
}

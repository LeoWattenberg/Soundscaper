/* SPDX-License-Identifier: AGPL-3.0-only */
import { open } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import type { MotionSustainedCdp, MotionSustainedTelemetry } from './motionscaper-sustained-cdp.ts';
import { sampleMotionOwnedProcesses } from './motionscaper-sustained-observation.ts';
import { MOTION_SUSTAINED_PLAN as plan, type MotionSustainedMemorySample } from './motionscaper-sustained-plan.ts';
import type { MotionProcessIdentity } from './motionscaper-sustained-process.ts';

export interface MotionSustainedPhaseSamples {
	readonly phase: string; readonly samples: readonly MotionSustainedMemorySample[];
	readonly processIdentities: readonly MotionProcessIdentity[]; readonly telemetry: readonly MotionSustainedTelemetry[];
	readonly logPath: string;
}
/** A phase cannot finish with stale, cached, main-page-only or empty-owner measurements. */
export async function startMotionSustainedSampler(options: Readonly<{
	phase: string; owner: MotionProcessIdentity; cdp: Pick<MotionSustainedCdp, 'sample'>; logPath: string;
	progress(): Promise<number>; expectedWorker?(): Readonly<{ targetId: string; sessionId: string; revision?: number; backend?: string }> | null;
	retainProcesses?(values: readonly MotionProcessIdentity[]): void;
}>) {
	const output = await open(options.logPath, 'wx', 0o600), started = performance.now();
	let previous: readonly MotionProcessIdentity[] = [], stopping = false, failure: unknown, sequence = 0;
	const samples: MotionSustainedMemorySample[] = [], telemetry: MotionSustainedTelemetry[] = [];
	const identities = new Map<string, MotionProcessIdentity>();
	const lastTelemetry = new Map<string, MotionSustainedTelemetry>();
	const interrupt = new AbortController();
	let rejectFailure!: (error: unknown) => void;
	const failed = new Promise<never>((_, reject) => { rejectFailure = reject; }); void failed.catch(() => undefined);
	const sample = async () => {
		const memory = await sampleMotionOwnedProcesses(options.owner, previous);
		previous = memory.processes.map(value => value.identity);
		options.retainProcesses?.(previous);
		if (!previous.some(value => value.pid === options.owner.pid && value.startTicks === options.owner.startTicks)) throw new Error('Active sustained owner disappeared or was replaced.');
		for (const value of previous) identities.set(`${value.pid}:${value.startTicks}`, value);
		const [targets, completedFrames] = await Promise.all([options.cdp.sample(), options.progress()]);
		if (!targets.some(value => value.type === 'page')) throw new Error('Active sustained page telemetry is missing.');
		const expectedWorker = options.expectedWorker?.();
		if (expectedWorker && !targets.some(value => value.type === 'worker' && value.workerName === 'motionscaper-composition-preview'
			&& value.targetId === expectedWorker.targetId && value.sessionId === expectedWorker.sessionId
			&& (expectedWorker.revision === undefined || value.revision === expectedWorker.revision)
			&& (expectedWorker.backend === undefined || value.backend === expectedWorker.backend))) throw new Error('Actual pinned preview worker telemetry is missing or changed.');
		for (const target of targets) {
			const prior = lastTelemetry.get(target.sessionId);
			if (prior && target.workerFrames < prior.workerFrames) throw new Error('Observed worker frame count regressed.');
		}
		const now = performance.now();
		if (targets.some(value => now - value.monotonicMs > plan.maximumSampleGapMs || value.monotonicMs < started - plan.maximumSampleGapMs)) throw new Error('Stale target telemetry.');
		if (samples.length >= plan.maximumSamples || now - started > plan.maximumPhaseMs) throw new Error('Sustained sampling admission exceeded.');
		const value: MotionSustainedMemorySample = { elapsedMs: now - started, completedFrames,
			telemetrySequence: ++sequence, telemetryElapsedMs: Math.max(0, Math.min(...targets.map(target => target.monotonicMs)) - started),
			rssBytes: memory.rssBytes, pssBytes: memory.pssBytes,
			isolateUsedHeapBytes: targets.map(target => target.usedHeapBytes), isolateTotalHeapBytes: targets.map(target => target.totalHeapBytes),
			wasmCapacityBytes: targets.flatMap(target => target.wasmCapacityBytes) };
		if (value.rssBytes > plan.maximumRssBytes || value.pssBytes > plan.maximumPssBytes
			|| value.isolateUsedHeapBytes.some(bytes => bytes > plan.maximumIsolateHeapBytes)
			|| value.wasmCapacityBytes.some(bytes => bytes > plan.maximumWasmCapacityBytes)) throw new Error('Declared memory ceiling exceeded.');
		if (samples.length && value.elapsedMs - samples.at(-1)!.elapsedMs > plan.maximumSampleGapMs) throw new Error('Declared process/telemetry cadence exceeded.');
		await output.write(`${JSON.stringify({ phase: options.phase, memory, targets, summary: value })}\n`);
		samples.push(value); telemetry.push(...targets);
		for (const target of targets) lastTelemetry.set(target.sessionId, target);
	};
	try { await sample(); } catch (error) { await output.close(); throw error; }
	const task = (async () => {
		try {
			while (!stopping) {
				try { await delay(Math.max(1, plan.samplePeriodMs - (performance.now() - started - samples.at(-1)!.elapsedMs)), undefined, { signal: interrupt.signal }); }
				catch (error) { if (stopping && interrupt.signal.aborted && error instanceof Error && error.name === 'AbortError') break; throw error; }
				if (!stopping) await sample();
			}
		} catch (error) { failure = error; rejectFailure(error); }
	})();
	let stopped: Promise<MotionSustainedPhaseSamples> | undefined;
	const stop = async (): Promise<MotionSustainedPhaseSamples> => {
		stopping = true; interrupt.abort(); await task;
		try { if (failure) throw failure; await sample(); await output.sync(); }
		finally { await output.close(); }
		return { phase: options.phase, samples, processIdentities: [...identities.values()], telemetry, logPath: options.logPath };
	};
	return {
		failed,
		assertHealthy() { if (failure) throw failure; },
		stop(): Promise<MotionSustainedPhaseSamples> { return stopped ??= stop(); },
	};
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	EbuLoudnessValue,
	EbuMeterSnapshot,
	LoudnessHistoryEntry,
	SessionLoudnessHistorySnapshot,
} from '../production-audio/loudness-history-session.ts';
import {
	METER_SESSION_POLICY,
	createSessionStripMeterStore,
	type StripMeterSnapshot,
} from '../production-audio/strip-meter-session.ts';
import { createStripAnalysisScheduler } from '../production-audio/strip-analysis-scheduler.ts';
import type { StripRef } from '../parameter-address.ts';
import type { StripMeterAnalyserBankV21 } from './strip-meter-analyser-bank-v21.ts';

export interface ProductionMeterRuntimeSnapshotV21 {
	readonly productionMeters: readonly StripMeterSnapshot[];
	readonly productionLoudnessHistory?: SessionLoudnessHistorySnapshot;
}

interface ProductionMeterRuntimeSessionV21 {
	readonly project: unknown;
	readonly meterStore: ReturnType<typeof createSessionStripMeterStore>;
	readonly scheduler: ReturnType<typeof createStripAnalysisScheduler>;
	readonly loudnessHistory: LoudnessSnapshotHistory;
}

interface LoudnessSnapshotHistory {
	push(value: unknown): SessionLoudnessHistorySnapshot | null;
	snapshot(): SessionLoudnessHistorySnapshot | null;
	reset(): void;
}

const MAXIMUM_SESSION_STRIPS = 128;
const MAXIMUM_HISTORY_ENTRIES = 6_000;
const MAXIMUM_ANALYSIS_FRAMES_PER_TICK = 16 * 1_024 * 1_024;
const sessions = new WeakMap<object, ProductionMeterRuntimeSessionV21>();
const analyserReadBuffers = new WeakMap<AnalyserNode, Float32Array>();

/** Sample all production meters through one bounded, project-scoped session. */
export function sampleProductionMeterSessionV21(
	owner: object,
	project: unknown,
	banks: ReadonlyMap<string, StripMeterAnalyserBankV21> | null | undefined,
	masterLoudness: unknown,
): ProductionMeterRuntimeSnapshotV21 {
	const session = sessionFor(owner, project);
	const bankValues = [...(banks?.values() ?? [])];
	const byStrip = new Map(bankValues.map((bank) => [stripKey(bank.strip), bank]));
	const plan = session.scheduler.plan(bankValues.map((bank) => ({
		strip: bank.strip,
		visible: true,
		armed: false,
		costFrames: bank.analysers.reduce((total, analyser) => total + analyserFrameCount(analyser), 0),
	})));
	for (const candidate of plan.scheduled) {
		const bank = byStrip.get(stripKey(candidate.strip));
		if (!bank) continue;
		session.meterStore.update(bank.strip, {
			channels: bank.analysers.map(readAnalyserFrames),
			channelLabels: bank.channelLabels,
		});
	}
	const loudness = session.loudnessHistory.push(masterLoudness);
	return Object.freeze({
		productionMeters: session.meterStore.snapshot(),
		...(loudness ? { productionLoudnessHistory: loudness } : {}),
	});
}

/** Reset is session-only; it never mutates the project, history, or export state. */
export function resetProductionMeterSessionV21(owner: object): void {
	const session = sessions.get(owner);
	session?.meterStore.reset();
	session?.scheduler.reset();
	session?.loudnessHistory.reset();
}

function sessionFor(owner: object, project: unknown): ProductionMeterRuntimeSessionV21 {
	const current = sessions.get(owner);
	if (current && current.project === project) return current;
	const session = Object.freeze({
		project,
		meterStore: createSessionStripMeterStore({
			maximumStrips: MAXIMUM_SESSION_STRIPS,
			maximumFramesPerUpdate: 256,
		}),
		scheduler: createStripAnalysisScheduler({
			maximumStripsPerTick: MAXIMUM_SESSION_STRIPS,
			maximumFramesPerTick: MAXIMUM_ANALYSIS_FRAMES_PER_TICK,
		}),
		loudnessHistory: createLoudnessSnapshotHistory(MAXIMUM_HISTORY_ENTRIES),
	});
	sessions.set(owner, session);
	return session;
}

function readAnalyserFrames(analyser: AnalyserNode): Float32Array {
	const frameCount = analyserFrameCount(analyser);
	let buffer = analyserReadBuffers.get(analyser);
	if (!buffer || buffer.length !== frameCount) {
		buffer = new Float32Array(frameCount);
		analyserReadBuffers.set(analyser, buffer);
	}
	analyser.getFloatTimeDomainData(buffer as Float32Array<ArrayBuffer>);
	return buffer;
}

function analyserFrameCount(analyser: AnalyserNode): number {
	const frameCount = Number(analyser.fftSize) || 256;
	if (!Number.isSafeInteger(frameCount) || frameCount < 1 || frameCount > 256) {
		throw new RangeError('Production strip analyser frames must be bounded to 256.');
	}
	return frameCount;
}

function createLoudnessSnapshotHistory(capacity: number): LoudnessSnapshotHistory {
	const history: LoudnessHistoryEntry[] = [];
	let current: EbuMeterSnapshot | null = null;
	let previousValue: unknown;
	let sequence = 0;
	const snapshot = (): SessionLoudnessHistorySnapshot | null => current && Object.freeze({
		policy: METER_SESSION_POLICY,
		current,
		history: Object.freeze([...history]),
	});
	return Object.freeze({
		push(value: unknown): SessionLoudnessHistorySnapshot | null {
			if (value === previousValue) return snapshot();
			const reading = normalizeEbuMeterSnapshot(value);
			if (!reading) return snapshot();
			previousValue = value;
			current = reading;
			const loudness = reading.loudness;
			history.push(Object.freeze({
				sequence: sequence += 1,
				measuredSeconds: loudness.measuredSeconds,
				momentaryLufs: loudness.momentaryLufs,
				shortTermLufs: loudness.shortTermLufs,
				integratedLufs: loudness.integratedLufs,
				loudnessRangeLu: loudness.loudnessRangeLu,
				truePeakDbtp: loudness.truePeakDbtp,
			}));
			if (history.length > capacity) history.splice(0, history.length - capacity);
			return snapshot();
		},
		snapshot,
		reset(): void {
			history.length = 0;
			current = null;
			previousValue = undefined;
			sequence = 0;
		},
	});
}

function normalizeEbuMeterSnapshot(value: unknown): EbuMeterSnapshot | null {
	if (!dataRecord(value)) return null;
	const loudness = normalizeEbuLoudness(value.loudness);
	if (!loudness) return null;
	const peak = finiteNumber(value.peak);
	const rms = finiteNumber(value.rms);
	const dbfs = decibel(value.dbfs);
	if (peak === null || peak < 0 || rms === null || rms < 0 || dbfs === null) return null;
	return Object.freeze({ peak, rms, dbfs, loudness });
}

function normalizeEbuLoudness(value: unknown): EbuLoudnessValue | null {
	if (!dataRecord(value) || typeof value.standard !== 'string' || typeof value.state !== 'string'
		|| typeof value.loudnessRangeStable !== 'boolean') return null;
	const momentaryLufs = nullableFinite(value.momentaryLufs);
	const shortTermLufs = nullableFinite(value.shortTermLufs);
	const integratedLufs = nullableFinite(value.integratedLufs);
	const maximumMomentaryLufs = nullableFinite(value.maximumMomentaryLufs);
	const maximumShortTermLufs = nullableFinite(value.maximumShortTermLufs);
	const loudnessRangeLu = nullableFinite(value.loudnessRangeLu);
	const truePeakDbtp = decibel(value.truePeakDbtp);
	const maximumTruePeakDbtp = nullableDecibel(value.maximumTruePeakDbtp);
	const measuredSeconds = finiteNumber(value.measuredSeconds);
	if (truePeakDbtp === null || [momentaryLufs, shortTermLufs, integratedLufs, maximumMomentaryLufs,
		maximumShortTermLufs, loudnessRangeLu, truePeakDbtp, maximumTruePeakDbtp,
		measuredSeconds].includes(undefined) || measuredSeconds === null || measuredSeconds < 0) return null;
	return Object.freeze({
		standard: value.standard,
		momentaryLufs: momentaryLufs as number | null,
		shortTermLufs: shortTermLufs as number | null,
		integratedLufs: integratedLufs as number | null,
		maximumMomentaryLufs: maximumMomentaryLufs as number | null,
		maximumShortTermLufs: maximumShortTermLufs as number | null,
		loudnessRangeLu: loudnessRangeLu as number | null,
		loudnessRangeStable: value.loudnessRangeStable,
		truePeakDbtp: truePeakDbtp as number,
		maximumTruePeakDbtp: maximumTruePeakDbtp as number | null,
		measuredSeconds,
		state: value.state,
	});
}

function finiteNumber(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nullableFinite(value: unknown): number | null | undefined {
	return value === null ? null : finiteNumber(value) ?? undefined;
}

function decibel(value: unknown): number | null {
	return typeof value === 'number' && (Number.isFinite(value) || value === Number.NEGATIVE_INFINITY)
		? value : null;
}

function nullableDecibel(value: unknown): number | null | undefined {
	return value === null ? null : decibel(value) ?? undefined;
}

function dataRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stripKey(strip: StripRef): string {
	return strip.kind === 'master' ? '["master"]' : JSON.stringify([strip.kind, strip.id]);
}

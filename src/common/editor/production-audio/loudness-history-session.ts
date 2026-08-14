/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray, readClosedDomainField, readClosedDomainRecord } from '../closed-domain-value.ts';
import { createEbuR128Meter } from '../ebu-r128.js';
import { METER_SESSION_POLICY } from './strip-meter-session.ts';

export interface EbuLoudnessValue {
	readonly standard: string;
	readonly momentaryLufs: number | null;
	readonly shortTermLufs: number | null;
	readonly integratedLufs: number | null;
	readonly maximumMomentaryLufs: number | null;
	readonly maximumShortTermLufs: number | null;
	readonly loudnessRangeLu: number | null;
	readonly loudnessRangeStable: boolean;
	readonly truePeakDbtp: number;
	readonly maximumTruePeakDbtp: number | null;
	readonly measuredSeconds: number;
	readonly state: string;
}

export interface EbuMeterSnapshot {
	readonly peak: number;
	readonly rms: number;
	readonly dbfs: number;
	readonly loudness: EbuLoudnessValue;
}

export interface LoudnessHistoryEntry {
	readonly sequence: number;
	readonly measuredSeconds: number;
	readonly momentaryLufs: number | null;
	readonly shortTermLufs: number | null;
	readonly integratedLufs: number | null;
	readonly loudnessRangeLu: number | null;
	readonly truePeakDbtp: number;
}

export interface SessionLoudnessHistorySnapshot {
	readonly policy: typeof METER_SESSION_POLICY;
	readonly current: EbuMeterSnapshot;
	readonly history: readonly LoudnessHistoryEntry[];
}

export interface SessionLoudnessHistory {
	push(channels: unknown): SessionLoudnessHistorySnapshot;
	setRunning(running: boolean): SessionLoudnessHistorySnapshot;
	snapshot(): SessionLoudnessHistorySnapshot;
	reset(): SessionLoudnessHistorySnapshot;
}

interface EbuMeter {
	push(
		channels: readonly Float32Array[],
		onSnapshot?: (snapshot: EbuMeterSnapshot) => void,
	): EbuMeter;
	setRunning(value: boolean): EbuMeter;
	reset(): EbuMeter;
	snapshot(): EbuMeterSnapshot;
}

const EBU_FACTORY = createEbuR128Meter as unknown as (options: Readonly<{
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly running: boolean;
}>) => EbuMeter;
const MAXIMUM_HISTORY_CAPACITY = 36_000;
const DEFAULT_HISTORY_CAPACITY = 6_000;
const MAXIMUM_PUSH_FRAMES = 65_536;

/** Keep a bounded 10 Hz view over the maintained EBU R128 meter. */
export function createSessionLoudnessHistory(optionsValue: unknown): SessionLoudnessHistory {
	const options = readClosedDomainRecord(
		optionsValue,
		'session loudness history options',
		['sampleRate', 'channelCount', 'capacity', 'running'],
		['sampleRate', 'channelCount'],
	);
	const sampleRate = boundedInteger(
		readClosedDomainField(options, 'sampleRate', 'session loudness history options'),
		'EBU R128 sample rate',
		8_000,
		768_000,
	);
	const channelCount = boundedInteger(
		readClosedDomainField(options, 'channelCount', 'session loudness history options'),
		'EBU R128 channel count',
		1,
		8,
	);
	const capacity = boundedInteger(
		optionalField(options, 'capacity', 'session loudness history options') ?? DEFAULT_HISTORY_CAPACITY,
		'session loudness history capacity',
		1,
		MAXIMUM_HISTORY_CAPACITY,
	);
	const runningValue = optionalField(options, 'running', 'session loudness history options');
	if (runningValue !== undefined && typeof runningValue !== 'boolean') {
		throw new TypeError('session loudness history running must be boolean.');
	}
	const meter = EBU_FACTORY({ sampleRate, channelCount, running: runningValue ?? true });
	const ring: Array<LoudnessHistoryEntry | undefined> = new Array(capacity);
	let writeIndex = 0;
	let size = 0;
	let sequence = 0;

	function record(snapshot: EbuMeterSnapshot): void {
		const loudness = snapshot.loudness;
		ring[writeIndex] = Object.freeze({
			sequence: sequence += 1,
			measuredSeconds: loudness.measuredSeconds,
			momentaryLufs: loudness.momentaryLufs,
			shortTermLufs: loudness.shortTermLufs,
			integratedLufs: loudness.integratedLufs,
			loudnessRangeLu: loudness.loudnessRangeLu,
			truePeakDbtp: loudness.truePeakDbtp,
		});
		writeIndex = (writeIndex + 1) % capacity;
		size = Math.min(capacity, size + 1);
	}

	function historySnapshot(): readonly LoudnessHistoryEntry[] {
		const entries: LoudnessHistoryEntry[] = [];
		const start = size === capacity ? writeIndex : 0;
		for (let offset = 0; offset < size; offset += 1) {
			const entry = ring[(start + offset) % capacity];
			if (entry) entries.push(entry);
		}
		return Object.freeze(entries);
	}

	function snapshot(): SessionLoudnessHistorySnapshot {
		return Object.freeze({
			policy: METER_SESSION_POLICY,
			current: meter.snapshot(),
			history: historySnapshot(),
		});
	}

	return Object.freeze({
		push(channelsValue: unknown): SessionLoudnessHistorySnapshot {
			meter.push(normalizePcm(channelsValue, channelCount), record);
			return snapshot();
		},
		setRunning(running: boolean): SessionLoudnessHistorySnapshot {
			if (typeof running !== 'boolean') throw new TypeError('EBU R128 running state must be boolean.');
			meter.setRunning(running);
			return snapshot();
		},
		snapshot,
		reset(): SessionLoudnessHistorySnapshot {
			meter.reset();
			ring.fill(undefined);
			writeIndex = 0;
			size = 0;
			sequence = 0;
			return snapshot();
		},
	});
}

function normalizePcm(value: unknown, channelCount: number): readonly Float32Array[] {
	const values = readClosedDomainArray(value, 'loudness PCM channels', channelCount, channelCount);
	let frameCount: number | null = null;
	return Object.freeze(values.map((channel, channelIndex) => {
		if (!(channel instanceof Float32Array)) {
			throw new TypeError(`loudness PCM channel ${String(channelIndex + 1)} must be Float32 PCM.`);
		}
		if (channel.length < 1 || channel.length > MAXIMUM_PUSH_FRAMES) {
			throw new RangeError(`loudness PCM pushes may contain at most ${String(MAXIMUM_PUSH_FRAMES)} frames.`);
		}
		if (frameCount === null) frameCount = channel.length;
		else if (channel.length !== frameCount) throw new RangeError('Loudness PCM channels must be aligned.');
		for (let frame = 0; frame < channel.length; frame += 1) {
			if (!Number.isFinite(channel[frame])) throw new RangeError('Loudness PCM samples must be finite.');
		}
		return channel;
	}));
}

function optionalField(
	record: Readonly<Record<string, unknown>>,
	field: string,
	name: string,
): unknown {
	return Object.hasOwn(record, field) ? readClosedDomainField(record, field, name) : undefined;
}

function boundedInteger(value: unknown, name: string, minimum: number, maximum: number): number {
	if (!Number.isSafeInteger(value) || Object.is(value, -0) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`${name} must be an integer from ${String(minimum)} through ${String(maximum)}.`);
	}
	return Number(value);
}

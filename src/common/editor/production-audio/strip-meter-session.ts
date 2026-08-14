/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	readClosedDomainArray,
	readClosedDomainField,
	readClosedDomainRecord,
} from '../closed-domain-value.ts';
import { normalizeStripRef } from '../parameter-address.ts';
import type { StripRef } from '../parameter-address.ts';

export interface StripChannelMeterSnapshot {
	readonly label: string;
	readonly peak: number;
	readonly rms: number;
}

export interface StripMeterSnapshot {
	readonly strip: StripRef;
	readonly sequence: number;
	readonly channelCount: number;
	readonly channels: readonly StripChannelMeterSnapshot[];
	readonly correlation: number | null;
	readonly phaseDegrees: number | null;
}

export interface StripMeterUpdate {
	readonly channels: readonly Float32Array[];
	readonly channelLabels: readonly string[];
}

export interface SessionStripMeterStore {
	update(strip: unknown, input: unknown): StripMeterSnapshot;
	get(strip: unknown): StripMeterSnapshot | null;
	snapshot(): readonly StripMeterSnapshot[];
	reset(): void;
}

const MAXIMUM_CHANNELS = 32;
const MAXIMUM_SESSION_STRIPS = 128;
const MAXIMUM_METER_FRAMES = 65_536;

export const METER_SESSION_POLICY = deepFreeze({
	authority: 'runtime-session',
	lifecycle: 'project-or-runtime-reset',
	scheduling: 'shared-budgeted-tick',
	projectFields: [] as readonly string[],
	historyFields: [] as readonly string[],
	exportTransforms: [] as readonly string[],
});

/**
 * Create bounded ephemeral meter state. The store has no timer, document port,
 * history port, or export port; a shared scheduler decides when `update` runs.
 */
export function createSessionStripMeterStore(optionsValue: unknown = {}): SessionStripMeterStore {
	const options = readClosedDomainRecord(
		optionsValue,
		'session strip meter options',
		['maximumStrips', 'maximumFramesPerUpdate'],
		[],
	);
	const maximumStrips = boundedInteger(
		optionalField(options, 'maximumStrips', 'session strip meter options') ?? MAXIMUM_SESSION_STRIPS,
		'session strip meter maximum strips',
		1,
		MAXIMUM_SESSION_STRIPS,
	);
	const maximumFramesPerUpdate = boundedInteger(
		optionalField(options, 'maximumFramesPerUpdate', 'session strip meter options') ?? MAXIMUM_METER_FRAMES,
		'session strip meter maximum frames per update',
		1,
		MAXIMUM_METER_FRAMES,
	);
	const states = new Map<string, StripMeterSnapshot>();
	let sequence = 0;

	return Object.freeze({
		update(stripValue: unknown, inputValue: unknown): StripMeterSnapshot {
			const strip = normalizeStripRef(stripValue);
			const input = normalizeUpdate(inputValue, maximumFramesPerUpdate);
			const snapshot = calculateSnapshot(strip, input, sequence += 1);
			const key = stripKey(strip);
			states.delete(key);
			states.set(key, snapshot);
			while (states.size > maximumStrips) {
				const oldest = states.keys().next().value as string | undefined;
				if (oldest === undefined) break;
				states.delete(oldest);
			}
			return snapshot;
		},
		get(stripValue: unknown): StripMeterSnapshot | null {
			return states.get(stripKey(normalizeStripRef(stripValue))) ?? null;
		},
		snapshot(): readonly StripMeterSnapshot[] {
			return Object.freeze([...states.values()]);
		},
		reset(): void {
			states.clear();
			sequence = 0;
		},
	});
}

function normalizeUpdate(value: unknown, maximumFrames: number): StripMeterUpdate {
	const record = readClosedDomainRecord(value, 'strip meter update', ['channels', 'channelLabels']);
	const channelValues = readClosedDomainArray(
		readClosedDomainField(record, 'channels', 'strip meter update'),
		'strip meter channels',
		1,
		MAXIMUM_CHANNELS,
	);
	let frameCount: number | null = null;
	const channels = channelValues.map((channel, index) => {
		if (!(channel instanceof Float32Array)) {
			throw new TypeError(`strip meter channels[${String(index)}] must be Float32 PCM.`);
		}
		if (channel.length < 1 || channel.length > maximumFrames) {
			throw new RangeError(`strip meter channels may contain at most ${String(maximumFrames)} frames.`);
		}
		if (frameCount === null) frameCount = channel.length;
		else if (channel.length !== frameCount) throw new RangeError('Strip meter channels must be aligned.');
		for (let frame = 0; frame < channel.length; frame += 1) {
			if (!Number.isFinite(channel[frame])) throw new RangeError('Strip meter PCM samples must be finite.');
		}
		return channel;
	});
	const labelValues = readClosedDomainArray(
		readClosedDomainField(record, 'channelLabels', 'strip meter update'),
		'strip meter channel labels',
		channels.length,
		channels.length,
	);
	const channelLabels = labelValues.map((value, index) => stableLabel(
		value,
		`strip meter channel label ${String(index + 1)}`,
	));
	if (new Set(channelLabels).size !== channelLabels.length) {
		throw new RangeError('Strip meter channel labels must be unique.');
	}
	return Object.freeze({ channels: Object.freeze(channels), channelLabels: Object.freeze(channelLabels) });
}

function calculateSnapshot(strip: StripRef, input: StripMeterUpdate, sequence: number): StripMeterSnapshot {
	const channels = input.channels.map((channel, channelIndex) => {
		let peak = 0;
		let squareSum = 0;
		for (let frame = 0; frame < channel.length; frame += 1) {
			const sample = channel[frame]!;
			peak = Math.max(peak, Math.abs(sample));
			squareSum += sample * sample;
		}
		return Object.freeze({
			label: input.channelLabels[channelIndex]!,
			peak,
			rms: Math.sqrt(squareSum / channel.length),
		});
	});
	const correlation = stereoCorrelation(input.channels);
	return deepFreeze({
		strip,
		sequence,
		channelCount: channels.length,
		channels,
		correlation,
		phaseDegrees: correlation === null ? null : normalizedPhaseDegrees(correlation),
	});
}

function stereoCorrelation(channels: readonly Float32Array[]): number | null {
	const left = channels[0];
	const right = channels[1];
	if (!left || !right) return null;
	let cross = 0;
	let leftSquares = 0;
	let rightSquares = 0;
	for (let frame = 0; frame < left.length; frame += 1) {
		const leftSample = left[frame]!;
		const rightSample = right[frame]!;
		cross += leftSample * rightSample;
		leftSquares += leftSample * leftSample;
		rightSquares += rightSample * rightSample;
	}
	const denominator = Math.sqrt(leftSquares * rightSquares);
	if (denominator === 0) return null;
	return Math.max(-1, Math.min(1, cross / denominator));
}

function normalizedPhaseDegrees(correlation: number): number {
	const degrees = Math.acos(correlation) * 180 / Math.PI;
	if (Math.abs(degrees) < 1e-12) return 0;
	if (Math.abs(degrees - 90) < 1e-12) return 90;
	if (Math.abs(degrees - 180) < 1e-12) return 180;
	return degrees;
}

function stripKey(strip: StripRef): string {
	return strip.kind === 'master' ? '["master"]' : JSON.stringify([strip.kind, strip.id]);
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

function stableLabel(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 32 || value.trim() !== value) {
		throw new RangeError(`${name} must contain 1 through 32 canonical characters.`);
	}
	return value;
}

function deepFreeze<T>(value: T): T {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}

/* SPDX-License-Identifier: AGPL-3.0-only */

export const SOUND_ACTIVATION_LIMITS = Object.freeze({
	minimumThresholdDb: -100,
	maximumThresholdDb: 0,
	maximumHysteresisDb: 24,
	maximumHoldFrames: 230_400_000,
});

export interface SoundActivationSettings {
	readonly thresholdDb: number;
	readonly hysteresisDb: number;
	readonly holdFrames: number;
}

export type SoundActivationGateState =
	| 'disarmed'
	| 'armed'
	| 'capturing'
	| 'paused'
	| 'cancelled';

export interface SoundActivationCaptureRange {
	readonly startFrame: number;
	readonly endFrame: number;
}

export interface SoundActivationTransition {
	readonly type: 'activated' | 'suspended';
	readonly frameOffset: number;
}

export interface SoundActivationProcessResult {
	readonly state: SoundActivationGateState;
	readonly ranges: readonly SoundActivationCaptureRange[];
	readonly transitions: readonly SoundActivationTransition[];
}

export interface SoundActivatedRecordingGate {
	readonly settings: SoundActivationSettings;
	readonly state: SoundActivationGateState;
	arm(): boolean;
	pause(): boolean;
	resume(): boolean;
	cancel(): boolean;
	process(channels: readonly Float32Array[]): SoundActivationProcessResult;
}

const SETTING_KEYS = Object.freeze(['thresholdDb', 'hysteresisDb', 'holdFrames'] as const);

export function normalizeSoundActivationSettings(value: unknown): SoundActivationSettings {
	const input = closedSettingsRecord(value);
	const thresholdDb = input.thresholdDb;
	const hysteresisDb = input.hysteresisDb;
	const holdFrames = input.holdFrames;
	if (!Number.isFinite(thresholdDb)
		|| Object.is(thresholdDb, -0)
		|| thresholdDb < SOUND_ACTIVATION_LIMITS.minimumThresholdDb
		|| thresholdDb > SOUND_ACTIVATION_LIMITS.maximumThresholdDb) {
		throw new RangeError('The sound activation threshold is invalid.');
	}
	if (!Number.isFinite(hysteresisDb)
		|| Object.is(hysteresisDb, -0)
		|| hysteresisDb < 0
		|| hysteresisDb > SOUND_ACTIVATION_LIMITS.maximumHysteresisDb) {
		throw new RangeError('The sound activation hysteresis is invalid.');
	}
	if (!Number.isSafeInteger(holdFrames)
		|| Object.is(holdFrames, -0)
		|| holdFrames < 0
		|| holdFrames > SOUND_ACTIVATION_LIMITS.maximumHoldFrames) {
		throw new RangeError('The sound activation hold is invalid.');
	}
	return Object.freeze({ thresholdDb, hysteresisDb, holdFrames });
}

export function createSoundActivatedRecordingGate(
	input: unknown,
): SoundActivatedRecordingGate {
	const settings = normalizeSoundActivationSettings(input);
	const activationAmplitude = decibelsToAmplitude(settings.thresholdDb);
	const suspensionAmplitude = decibelsToAmplitude(
		settings.thresholdDb - settings.hysteresisDb,
	);
	let state: SoundActivationGateState = 'disarmed';
	let quietFrames = 0;

	const gate: SoundActivatedRecordingGate = {
		settings,
		get state() { return state; },
		arm,
		pause,
		resume,
		cancel,
		process,
	};
	return Object.freeze(gate);

	function arm(): boolean {
		if (state !== 'disarmed' && state !== 'cancelled') return false;
		quietFrames = 0;
		state = 'armed';
		return true;
	}

	function pause(): boolean {
		if (state !== 'armed' && state !== 'capturing') return false;
		quietFrames = 0;
		state = 'paused';
		return true;
	}

	function resume(): boolean {
		if (state !== 'paused') return false;
		quietFrames = 0;
		state = 'armed';
		return true;
	}

	function cancel(): boolean {
		if (state === 'cancelled') return false;
		quietFrames = 0;
		state = 'cancelled';
		return true;
	}

	function process(channels: readonly Float32Array[]): SoundActivationProcessResult {
		const frameCount = validateChannels(channels);
		if (state === 'disarmed' || state === 'paused' || state === 'cancelled' || frameCount === 0) {
			return result([], []);
		}
		const ranges: SoundActivationCaptureRange[] = [];
		const transitions: SoundActivationTransition[] = [];
		let rangeStart: number | null = null;
		for (let frame = 0; frame < frameCount; frame += 1) {
			const peak = framePeak(channels, frame);
			let capture = false;
			if (state === 'armed') {
				if (peak >= activationAmplitude) {
					state = 'capturing';
					quietFrames = 0;
					transitions.push(frozenTransition('activated', frame));
					capture = true;
				}
			} else if (state === 'capturing') {
				if (peak >= suspensionAmplitude) {
					quietFrames = 0;
					capture = true;
				} else {
					quietFrames += 1;
					if (quietFrames <= settings.holdFrames) capture = true;
					else {
						state = 'armed';
						quietFrames = 0;
						transitions.push(frozenTransition('suspended', frame));
					}
				}
			}
			if (capture && rangeStart === null) rangeStart = frame;
			if (!capture && rangeStart !== null) {
				ranges.push(frozenRange(rangeStart, frame));
				rangeStart = null;
			}
		}
		if (rangeStart !== null) ranges.push(frozenRange(rangeStart, frameCount));
		return result(ranges, transitions);
	}

	function result(
		ranges: SoundActivationCaptureRange[],
		transitions: SoundActivationTransition[],
	): SoundActivationProcessResult {
		return Object.freeze({
			state,
			ranges: Object.freeze(ranges),
			transitions: Object.freeze(transitions),
		});
	}
}

function closedSettingsRecord(value: unknown): Record<(typeof SETTING_KEYS)[number], number> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new TypeError('The sound activation settings are invalid.');
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError('The sound activation settings must be a plain record.');
	}
	const record = value as Record<PropertyKey, unknown>;
	const keys = Reflect.ownKeys(record);
	if (keys.length !== SETTING_KEYS.length || keys.some((key) => (
		typeof key !== 'string' || !SETTING_KEYS.includes(key as (typeof SETTING_KEYS)[number])
	))) throw new TypeError('The sound activation settings contain an unknown field.');
	for (const key of SETTING_KEYS) {
		const descriptor = Object.getOwnPropertyDescriptor(record, key);
		if (!descriptor?.enumerable || !('value' in descriptor) || typeof descriptor.value !== 'number') {
			throw new TypeError(`The sound activation ${key} is invalid.`);
		}
	}
	return record as Record<(typeof SETTING_KEYS)[number], number>;
}

function validateChannels(channels: readonly Float32Array[]): number {
	if (!Array.isArray(channels) || channels.length === 0) {
		throw new TypeError('Sound activation requires at least one audio channel.');
	}
	const frameCount = channels[0] instanceof Float32Array ? channels[0].length : -1;
	for (const channel of channels) {
		if (!(channel instanceof Float32Array)) {
			throw new TypeError('Sound activation channels must use Float32Array samples.');
		}
		if (channel.length !== frameCount) {
			throw new RangeError('Sound activation channel lengths must match.');
		}
	}
	return frameCount;
}

function framePeak(channels: readonly Float32Array[], frame: number): number {
	let peak = 0;
	for (const channel of channels) {
		const sample = Math.abs(channel[frame] ?? 0);
		if (Number.isFinite(sample)) peak = Math.max(peak, sample);
	}
	return peak;
}

function decibelsToAmplitude(decibels: number): number {
	return 10 ** (decibels / 20);
}

function frozenRange(startFrame: number, endFrame: number): SoundActivationCaptureRange {
	return Object.freeze({ startFrame, endFrame });
}

function frozenTransition(
	type: SoundActivationTransition['type'],
	frameOffset: number,
): SoundActivationTransition {
	return Object.freeze({ type, frameOffset });
}

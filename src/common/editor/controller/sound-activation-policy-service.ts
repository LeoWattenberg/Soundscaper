/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	SOUND_ACTIVATION_PREFERENCE_LIMITS,
	normalizeSoundActivationPreferences,
	soundActivationSettingsFromPreferences,
	type SoundActivationPreferences,
} from '../sound-activation-preferences.ts';
import type { RecordingSessionMutableState } from './recording-session-service.ts';
import type {
	RecordingSoundActivationPort,
	RecordingSoundActivationSource,
} from './recording-transaction-types.ts';
import type {
	SoundActivationGateState,
	SoundActivationSettings,
} from './sound-activated-recording-gate.ts';

type MaybePromise<T> = T | PromiseLike<T>;

export type SoundActivationPolicyRecordingState = Pick<
	RecordingSessionMutableState,
	| 'recordingStarting'
	| 'recordingStartPromise'
	| 'timedRecordingPreparing'
	| 'timedRecording'
	| 'recorder'
	| 'recordingFinishing'
>;

export interface SoundActivationPreferencePatch {
	readonly recording: Readonly<{
		readonly soundActivation: SoundActivationPreferences;
	}>;
}

export interface SoundActivationPolicyServiceDependencies {
	readonly state: SoundActivationPolicyRecordingState;
	/** Returns the currently committed, globally scoped preference record. */
	readonly getPreferences: () => unknown;
	/**
	 * Atomically commits the complete record and makes getPreferences reflect it
	 * before this operation resolves. A rejected operation must retain the old
	 * committed record.
	 */
	readonly updatePreferences: (patch: SoundActivationPreferencePatch) => MaybePromise<unknown>;
	/** Publishes after a source observation or preference-update state changes. */
	readonly publish?: () => void;
}

export type SoundActivationPreferenceMutationBlockReason =
	| 'preference-update'
	| 'recording-scheduling'
	| 'recording-prepared'
	| 'recording-active'
	| 'recording-finishing';

export interface SoundActivationSourceSnapshot {
	readonly sourceKey: string;
	readonly kind: RecordingSoundActivationSource['kind'];
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly settings: SoundActivationSettings;
	readonly state: SoundActivationGateState;
}

export interface SoundActivationPolicySnapshot {
	readonly preferences: SoundActivationPreferences;
	readonly preferenceMutationBlocked: boolean;
	readonly preferenceMutationBlockReason: SoundActivationPreferenceMutationBlockReason | null;
	readonly sources: readonly SoundActivationSourceSnapshot[];
}

export interface SoundActivationPolicyService extends RecordingSoundActivationPort {
	getSnapshot(): SoundActivationPolicySnapshot;
	setEnabled(value: unknown): Promise<boolean>;
	setThresholdDb(value: unknown): Promise<boolean>;
	setHysteresisDb(value: unknown): Promise<boolean>;
	setHoldMilliseconds(value: unknown): Promise<boolean>;
	discardSource(sourceKey: unknown): boolean;
	resetSources(): boolean;
}

interface SourceSession {
	readonly source: RecordingSoundActivationSource;
	readonly settings: SoundActivationSettings;
	state: SoundActivationGateState;
}

const SOURCE_KEYS = Object.freeze([
	'sourceKey',
	'kind',
	'sampleRate',
	'channelCount',
] as const);

const GATE_STATES = new Set<SoundActivationGateState>([
	'disarmed',
	'armed',
	'capturing',
	'paused',
	'cancelled',
]);

/**
 * Bridge one global preference record to per-input capture gates. Settings are
 * converted and cached on first admission of a source key, so a physical input
 * shared by several routed tracks still owns one immutable gate configuration.
 */
export function createSoundActivationPolicyService(
	dependencies: SoundActivationPolicyServiceDependencies,
): SoundActivationPolicyService {
	const sessions = new Map<string, SourceSession>();
	const publish = dependencies.publish ?? (() => {});
	let preferenceUpdatePending = false;
	let pendingPreferences: SoundActivationPreferences | null = null;

	return Object.freeze({
		getSettings,
		setState,
		getSnapshot,
		setEnabled: (value: unknown) => mutatePreference('enabled', value),
		setThresholdDb: (value: unknown) => mutatePreference('thresholdDb', value),
		setHysteresisDb: (value: unknown) => mutatePreference('hysteresisDb', value),
		setHoldMilliseconds: (value: unknown) => mutatePreference('holdMilliseconds', value),
		discardSource,
		resetSources,
	});

	function getSettings(sourceValue: RecordingSoundActivationSource): SoundActivationSettings | null {
		const source = normalizeSource(sourceValue);
		const existing = sessions.get(source.sourceKey);
		if (existing) {
			assertSameSource(existing.source, source);
			return existing.settings;
		}
		const settings = soundActivationSettingsFromPreferences(readPreferences(), source.sampleRate);
		if (settings === null) return null;
		sessions.set(source.sourceKey, {
			source,
			settings,
			state: 'disarmed',
		});
		publish();
		return settings;
	}

	function setState(
		sourceValue: RecordingSoundActivationSource,
		stateValue: SoundActivationGateState,
	): void {
		const source = normalizeSource(sourceValue);
		if (!GATE_STATES.has(stateValue)) {
			throw new TypeError('The sound activation gate state is invalid.');
		}
		const session = sessions.get(source.sourceKey);
		if (!session) return;
		assertSameSource(session.source, source);
		if (session.state === stateValue) return;
		if (stateValue === 'cancelled') {
			sessions.delete(source.sourceKey);
			publish();
			return;
		}
		session.state = stateValue;
		publish();
	}

	function getSnapshot(): SoundActivationPolicySnapshot {
		const blockReason = preferenceMutationBlockReason();
		const sources = [...sessions.values()]
			.sort((left, right) => compareSourceKeys(left.source.sourceKey, right.source.sourceKey))
			.map(({ source, settings, state }) => Object.freeze({
				sourceKey: source.sourceKey,
				kind: source.kind,
				sampleRate: source.sampleRate,
				channelCount: source.channelCount,
				settings,
				state,
			}));
		return Object.freeze({
			preferences: readPreferences(),
			preferenceMutationBlocked: blockReason !== null,
			preferenceMutationBlockReason: blockReason,
			sources: Object.freeze(sources),
		});
	}

	async function mutatePreference(
		field: keyof SoundActivationPreferences,
		value: unknown,
	): Promise<boolean> {
		if (preferenceMutationBlockReason() !== null) return false;
		const current = readPreferences();
		const next = normalizeSoundActivationPreferences({
			...current,
			[field]: value,
		});
		if (preferencesEqual(current, next)) return false;
		const patch = frozenPreferencePatch(next);
		pendingPreferences = current;
		preferenceUpdatePending = true;
		try {
			publish();
			await dependencies.updatePreferences(patch);
			if (!preferencesEqual(readPublishedPreferences(), next)) {
				throw new Error('The sound activation preference update did not commit atomically.');
			}
			return true;
		} finally {
			preferenceUpdatePending = false;
			pendingPreferences = null;
			publish();
		}
	}

	function discardSource(sourceKeyValue: unknown): boolean {
		const sourceKey = normalizeSourceKey(sourceKeyValue);
		if (!sessions.delete(sourceKey)) return false;
		publish();
		return true;
	}

	function resetSources(): boolean {
		if (sessions.size === 0) return false;
		sessions.clear();
		publish();
		return true;
	}

	function readPreferences(): SoundActivationPreferences {
		if (pendingPreferences) return pendingPreferences;
		return readPublishedPreferences();
	}

	function readPublishedPreferences(): SoundActivationPreferences {
		return normalizeSoundActivationPreferences(dependencies.getPreferences());
	}

	function preferenceMutationBlockReason(): SoundActivationPreferenceMutationBlockReason | null {
		const { state } = dependencies;
		if (preferenceUpdatePending) return 'preference-update';
		if (state.recordingFinishing) return 'recording-finishing';
		if (state.recordingStarting || state.recordingStartPromise || state.timedRecordingPreparing) {
			return 'recording-scheduling';
		}
		if (state.timedRecording) return 'recording-prepared';
		if (state.recorder) return 'recording-active';
		return null;
	}
}

function normalizeSource(value: unknown): RecordingSoundActivationSource {
	const input = closedSourceRecord(value);
	const sourceKey = normalizeSourceKey(input.sourceKey);
	if (input.kind !== 'device' && input.kind !== 'display') {
		throw new TypeError('The sound activation source kind is invalid.');
	}
	if (!Number.isSafeInteger(input.sampleRate)
		|| Object.is(input.sampleRate, -0)
		|| Number(input.sampleRate) <= 0
		|| Number(input.sampleRate) > SOUND_ACTIVATION_PREFERENCE_LIMITS.maximumSampleRate) {
		throw new RangeError('The sound activation source sample rate is invalid.');
	}
	if (!Number.isSafeInteger(input.channelCount)
		|| Object.is(input.channelCount, -0)
		|| Number(input.channelCount) <= 0) {
		throw new RangeError('The sound activation source channel count is invalid.');
	}
	return Object.freeze({
		sourceKey,
		kind: input.kind,
		sampleRate: Number(input.sampleRate),
		channelCount: Number(input.channelCount),
	});
}

function closedSourceRecord(
	value: unknown,
): Record<(typeof SOURCE_KEYS)[number], unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new TypeError('The sound activation source must be a plain data record.');
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError('The sound activation source must be a plain data record.');
	}
	const record = value as Record<PropertyKey, unknown>;
	const keys = Reflect.ownKeys(record);
	if (keys.length !== SOURCE_KEYS.length || keys.some((key) => (
		typeof key !== 'string' || !SOURCE_KEYS.includes(key as (typeof SOURCE_KEYS)[number])
	))) throw new TypeError('The sound activation source contains an unknown or missing field.');
	const snapshot = Object.create(null) as Record<(typeof SOURCE_KEYS)[number], unknown>;
	for (const key of SOURCE_KEYS) {
		const descriptor = Object.getOwnPropertyDescriptor(record, key);
		if (!descriptor?.enumerable || !('value' in descriptor)) {
			throw new TypeError(`The sound activation source ${key} must be enumerable data.`);
		}
		snapshot[key] = descriptor.value;
	}
	return snapshot;
}

function normalizeSourceKey(value: unknown): string {
	if (typeof value !== 'string' || !value.trim()) {
		throw new TypeError('The sound activation source key is invalid.');
	}
	return value;
}

function assertSameSource(
	expected: RecordingSoundActivationSource,
	actual: RecordingSoundActivationSource,
): void {
	if (expected.kind !== actual.kind
		|| expected.sampleRate !== actual.sampleRate
		|| expected.channelCount !== actual.channelCount) {
		throw new RangeError(
			`The sound activation source changed during session ${actual.sourceKey}.`,
		);
	}
}

function frozenPreferencePatch(
	preferences: SoundActivationPreferences,
): SoundActivationPreferencePatch {
	return Object.freeze({
		recording: Object.freeze({ soundActivation: preferences }),
	});
}

function preferencesEqual(
	left: SoundActivationPreferences,
	right: SoundActivationPreferences,
): boolean {
	return left.enabled === right.enabled
		&& left.thresholdDb === right.thresholdDb
		&& left.hysteresisDb === right.hysteresisDb
		&& left.holdMilliseconds === right.holdMilliseconds;
}

function compareSourceKeys(left: string, right: string): number {
	if (left < right) return -1;
	if (left > right) return 1;
	return 0;
}

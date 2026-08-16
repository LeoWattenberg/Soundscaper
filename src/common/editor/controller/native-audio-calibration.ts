/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Latency calibration for a native audio session.
 *
 * A measured offset only describes the exact rig it was measured on, so it is
 * keyed by the whole tuple that can move underneath it: both endpoints, the
 * backend, the negotiated mode, and the sample rate and buffer size that were
 * actually granted rather than the ones that were asked for. Any member that
 * changes makes the measurement stale, and a stale measurement is reported
 * rather than applied: silently reusing it would shift recorded audio by a
 * number nobody measured.
 *
 * The resolved offset lands in the existing recording-routing offset map under
 * the source key the Web Core path already uses, so a native calibration is a
 * value in the one latency model, not a second one.
 */

import { PLATFORM_TRANSFER_HARD_LIMITS } from '../platform/bounded-transfer.ts';
import { isOpaqueNativeAudioHandle } from './native-audio-inventory.ts';
import {
	normalizeRecordingSourceOffset,
	recordingRouteSourceKey,
	setRecordingSourceOffset,
} from '../recording-routing.js';

export const NATIVE_AUDIO_MODES = Object.freeze(['shared', 'exclusive'] as const);
export type NativeAudioMode = (typeof NATIVE_AUDIO_MODES)[number];

/** The tuple, in the order every key, diff and report states it. */
export const NATIVE_AUDIO_CALIBRATION_MEMBERS = Object.freeze([
	'inputDeviceId', 'outputDeviceId', 'backend', 'mode', 'sampleRate', 'bufferFrames',
] as const);
export type NativeAudioCalibrationMember = (typeof NATIVE_AUDIO_CALIBRATION_MEMBERS)[number];

export const NATIVE_AUDIO_CALIBRATION_KEY_PREFIX = 'native-audio-calibration-v1:';

export const NATIVE_AUDIO_CALIBRATION_LIMITS = Object.freeze({
	maximumEntries: 64,
	maximumDeviceIdLength: 512,
	maximumBackendLength: 32,
	minimumSampleRate: 8_000,
	maximumSampleRate: 768_000,
	maximumBufferFrames: PLATFORM_TRANSFER_HARD_LIMITS.audioChunkFrames,
});

export interface NativeAudioCalibrationIdentity {
	readonly inputDeviceId: string;
	readonly outputDeviceId: string;
	readonly backend: string;
	readonly mode: NativeAudioMode;
	readonly sampleRate: number;
	readonly bufferFrames: number;
}

export interface NativeAudioCalibrationEntry {
	readonly identity: Readonly<NativeAudioCalibrationIdentity>;
	readonly key: string;
	readonly offsetMilliseconds: number;
	readonly measuredAtEpochMs: number;
}

/**
 * `offsetMilliseconds` is zero for every resolution but `applied`, so a caller
 * cannot reach for a stale number without noticing that it did.
 */
export type NativeAudioCalibrationResolution = Readonly<
	| { status: 'applied'; key: string; entry: NativeAudioCalibrationEntry; offsetMilliseconds: number }
	| {
		status: 'stale';
		key: string;
		entry: NativeAudioCalibrationEntry;
		changed: readonly NativeAudioCalibrationMember[];
		offsetMilliseconds: 0;
	}
	| { status: 'absent'; key: string; offsetMilliseconds: 0 }
>;

export interface NativeAudioCalibrationStore {
	record(identity: unknown, offsetMilliseconds: unknown): NativeAudioCalibrationEntry;
	resolve(identity: unknown): NativeAudioCalibrationResolution;
	forget(identity: unknown): boolean;
	/** Persistable, ordered by key so a saved settings blob is stable. */
	snapshot(): readonly NativeAudioCalibrationEntry[];
}

export interface NativeAudioCalibrationStoreOptions {
	readonly entries?: readonly unknown[];
	readonly now?: () => number;
}

/** The recording-routing offset map keyed by source key, as the service holds it. */
export interface RecordingRoutingLike {
	readonly routes: Readonly<Record<string, unknown>>;
	readonly offsets: Readonly<Record<string, number>>;
}

export function normalizeNativeAudioCalibrationIdentity(
	value: unknown,
): Readonly<NativeAudioCalibrationIdentity> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('A native audio calibration identity must be an object.');
	}
	const record = value as Readonly<Record<string, unknown>>;
	const inputDeviceId = calibrationDeviceId(record.inputDeviceId, 'input');
	const outputDeviceId = calibrationDeviceId(record.outputDeviceId, 'output');
	if (!inputDeviceId && !outputDeviceId) {
		throw new TypeError('A native audio calibration identity requires at least one endpoint.');
	}
	if (typeof record.mode !== 'string' || !(NATIVE_AUDIO_MODES as readonly string[]).includes(record.mode)) {
		throw new RangeError('A native audio calibration identity must name a shared or exclusive mode.');
	}
	const backend = String(record.backend ?? '');
	if (!backend || backend.length > NATIVE_AUDIO_CALIBRATION_LIMITS.maximumBackendLength) {
		throw new RangeError('A native audio calibration identity must name a bounded backend.');
	}
	return Object.freeze({
		inputDeviceId,
		outputDeviceId,
		backend,
		mode: record.mode as NativeAudioMode,
		sampleRate: calibrationInteger(
			record.sampleRate,
			NATIVE_AUDIO_CALIBRATION_LIMITS.minimumSampleRate,
			NATIVE_AUDIO_CALIBRATION_LIMITS.maximumSampleRate,
			'sample rate',
		),
		bufferFrames: calibrationInteger(
			record.bufferFrames,
			1,
			NATIVE_AUDIO_CALIBRATION_LIMITS.maximumBufferFrames,
			'buffer frames',
		),
	});
}

/**
 * The key is the tuple itself. A device label or a raw handle is never part of
 * it: labels change with a driver update and would silently orphan a valid
 * measurement, and nothing outside main is allowed to hold a device path.
 */
export function nativeAudioCalibrationKey(identity: unknown): string {
	const normalized = normalizeNativeAudioCalibrationIdentity(identity);
	return NATIVE_AUDIO_CALIBRATION_KEY_PREFIX + JSON.stringify(
		NATIVE_AUDIO_CALIBRATION_MEMBERS.map((member) => normalized[member]),
	);
}

/** Which members moved, in tuple order, so a surface can say what went stale. */
export function nativeAudioCalibrationDrift(
	recorded: unknown,
	current: unknown,
): readonly NativeAudioCalibrationMember[] {
	const before = normalizeNativeAudioCalibrationIdentity(recorded);
	const after = normalizeNativeAudioCalibrationIdentity(current);
	return Object.freeze(NATIVE_AUDIO_CALIBRATION_MEMBERS.filter((member) => before[member] !== after[member]));
}

export function createNativeAudioCalibrationStore(
	options: NativeAudioCalibrationStoreOptions = {},
): NativeAudioCalibrationStore {
	if (!options || typeof options !== 'object' || Array.isArray(options)) {
		throw new TypeError('Native audio calibration store options must be an object.');
	}
	const clock = options.now ?? (() => Date.now());
	const entries = new Map<string, NativeAudioCalibrationEntry>();
	for (const candidate of options.entries ?? []) {
		// A settings blob outlives devices and builds. One unreadable row must
		// not cost the user every other measurement they have taken.
		try {
			const entry = admitEntry(candidate);
			entries.set(entry.key, entry);
		} catch { /* Malformed persisted calibration is dropped, never applied. */ }
	}
	evict();

	return Object.freeze({ record, resolve, forget, snapshot });

	function record(identityValue: unknown, offsetValue: unknown): NativeAudioCalibrationEntry {
		const identity = normalizeNativeAudioCalibrationIdentity(identityValue);
		if (typeof offsetValue !== 'number' || !Number.isFinite(offsetValue)) {
			throw new TypeError('A native audio calibration offset must be a finite number of milliseconds.');
		}
		const entry = Object.freeze({
			identity,
			key: nativeAudioCalibrationKey(identity),
			offsetMilliseconds: normalizeRecordingSourceOffset(offsetValue) as number,
			measuredAtEpochMs: measuredAt(clock()),
		});
		entries.set(entry.key, entry);
		evict();
		return entry;
	}

	function resolve(identityValue: unknown): NativeAudioCalibrationResolution {
		const identity = normalizeNativeAudioCalibrationIdentity(identityValue);
		const key = nativeAudioCalibrationKey(identity);
		const exact = entries.get(key);
		if (exact) {
			return Object.freeze({
				status: 'applied' as const,
				key,
				entry: exact,
				offsetMilliseconds: exact.offsetMilliseconds,
			});
		}
		const nearest = nearestEntry(identity);
		if (!nearest) return Object.freeze({ status: 'absent' as const, key, offsetMilliseconds: 0 as const });
		return Object.freeze({
			status: 'stale' as const,
			key,
			entry: nearest,
			changed: nativeAudioCalibrationDrift(nearest.identity, identity),
			offsetMilliseconds: 0 as const,
		});
	}

	function forget(identityValue: unknown): boolean {
		return entries.delete(nativeAudioCalibrationKey(identityValue));
	}

	function snapshot(): readonly NativeAudioCalibrationEntry[] {
		return Object.freeze([...entries.values()].sort((first, second) => compareText(first.key, second.key)));
	}

	/**
	 * A measurement still describes this rig when one of its endpoints is still
	 * in play; anything else belongs to hardware that is not connected and is
	 * not worth reporting as stale. Ranking is total — fewest moved members,
	 * then the most recent measurement, then the key — so the same store always
	 * names the same entry.
	 */
	function nearestEntry(identity: Readonly<NativeAudioCalibrationIdentity>): NativeAudioCalibrationEntry | null {
		let best: NativeAudioCalibrationEntry | null = null;
		let bestChanged = Number.POSITIVE_INFINITY;
		for (const entry of entries.values()) {
			if (!sharesEndpoint(entry.identity, identity)) continue;
			const changed = nativeAudioCalibrationDrift(entry.identity, identity).length;
			if (best && !isBetterCandidate(changed, entry, bestChanged, best)) continue;
			best = entry;
			bestChanged = changed;
		}
		return best;
	}

	function evict(): void {
		while (entries.size > NATIVE_AUDIO_CALIBRATION_LIMITS.maximumEntries) {
			let oldest: NativeAudioCalibrationEntry | null = null;
			for (const entry of entries.values()) {
				if (oldest && !isOlder(entry, oldest)) continue;
				oldest = entry;
			}
			if (!oldest) return;
			entries.delete(oldest.key);
		}
	}
}

/**
 * Applies a resolved offset to the existing routing offsets. Only an exact
 * tuple hit changes the routing: a stale or absent measurement returns the
 * routing it was handed, unchanged and identical by reference.
 */
export function applyNativeAudioCalibration<Routing extends RecordingRoutingLike>(
	routing: Routing,
	identityValue: unknown,
	store: NativeAudioCalibrationStore,
): Readonly<{ routing: Routing; resolution: NativeAudioCalibrationResolution }> {
	const identity = normalizeNativeAudioCalibrationIdentity(identityValue);
	if (!identity.inputDeviceId) {
		throw new TypeError('A native audio calibration offset applies to a recording input source.');
	}
	const resolution = store.resolve(identity);
	if (resolution.status !== 'applied') return Object.freeze({ routing, resolution });
	const updated = setRecordingSourceOffset(
		routing,
		nativeAudioCalibrationSourceKey(identity),
		resolution.offsetMilliseconds,
	) as Routing;
	return Object.freeze({ routing: updated, resolution });
}

/** The same source key the Web Core recording path already stores offsets under. */
export function nativeAudioCalibrationSourceKey(identity: unknown): string {
	const normalized = normalizeNativeAudioCalibrationIdentity(identity);
	if (!normalized.inputDeviceId) {
		throw new TypeError('A native audio calibration source key requires an input endpoint.');
	}
	return recordingRouteSourceKey({ kind: 'device', deviceId: normalized.inputDeviceId }) as string;
}

function admitEntry(value: unknown): NativeAudioCalibrationEntry {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('A persisted native audio calibration entry must be an object.');
	}
	const record = value as Readonly<Record<string, unknown>>;
	const identity = normalizeNativeAudioCalibrationIdentity(record.identity);
	if (typeof record.offsetMilliseconds !== 'number' || !Number.isFinite(record.offsetMilliseconds)) {
		throw new TypeError('A persisted native audio calibration offset must be a finite number.');
	}
	return Object.freeze({
		identity,
		key: nativeAudioCalibrationKey(identity),
		offsetMilliseconds: normalizeRecordingSourceOffset(record.offsetMilliseconds) as number,
		measuredAtEpochMs: measuredAt(record.measuredAtEpochMs),
	});
}

function isBetterCandidate(
	changed: number,
	entry: NativeAudioCalibrationEntry,
	bestChanged: number,
	best: NativeAudioCalibrationEntry,
): boolean {
	if (changed !== bestChanged) return changed < bestChanged;
	if (entry.measuredAtEpochMs !== best.measuredAtEpochMs) return entry.measuredAtEpochMs > best.measuredAtEpochMs;
	return compareText(entry.key, best.key) < 0;
}

function isOlder(entry: NativeAudioCalibrationEntry, other: NativeAudioCalibrationEntry): boolean {
	if (entry.measuredAtEpochMs !== other.measuredAtEpochMs) return entry.measuredAtEpochMs < other.measuredAtEpochMs;
	return compareText(entry.key, other.key) < 0;
}

function sharesEndpoint(
	recorded: Readonly<NativeAudioCalibrationIdentity>,
	current: Readonly<NativeAudioCalibrationIdentity>,
): boolean {
	const endpoints = new Set([recorded.inputDeviceId, recorded.outputDeviceId].filter(Boolean));
	return [current.inputDeviceId, current.outputDeviceId].some((id) => id !== '' && endpoints.has(id));
}

function calibrationDeviceId(value: unknown, label: string): string {
	if (value == null || value === '') return '';
	if (typeof value !== 'string') throw new TypeError(`A native audio calibration ${label} device must be text.`);
	if (value.length > NATIVE_AUDIO_CALIBRATION_LIMITS.maximumDeviceIdLength) {
		throw new RangeError(`A native audio calibration ${label} device identifier is too long.`);
	}
	// An identity is persisted and is turned into a routing source key, so a
	// path admitted here would outlive the session holding it outside main.
	if (!isOpaqueNativeAudioHandle(value)) {
		throw new TypeError(`A native audio calibration ${label} device identifier must be opaque, never a path.`);
	}
	return value;
}

function calibrationInteger(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
		throw new RangeError(`A native audio calibration ${label} is outside its admitted bounds.`);
	}
	return value as number;
}

function measuredAt(value: unknown): number {
	const timestamp = Number(value);
	return Number.isFinite(timestamp) ? Math.max(0, Math.round(timestamp)) : 0;
}

/** Code-unit order, so a snapshot does not reorder itself with the locale. */
function compareText(first: string, second: string): number {
	return first < second ? -1 : first > second ? 1 : 0;
}

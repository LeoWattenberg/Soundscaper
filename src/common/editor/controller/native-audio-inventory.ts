/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Adapts a native backend's device inventory into the rows the editor already
 * holds. Split from native-audio-session.ts because the ceiling on one module
 * is 600 lines and the session owns lifecycle, not identity: this file owns the
 * stable device id, the channel topology derived from it, and the admission
 * that keeps a raw path from ever reaching renderer state through a handle.
 *
 * Nothing here mints a device model of its own. An input becomes a
 * `state.recordingDevices` row and an output an `state.audioOutputDevices` row,
 * both keyed by an id that is a pure function of what main published, so saved
 * preferences, routes and channel selections survive re-enumeration and
 * restarts without a second device model to reconcile them against.
 */

import { PLATFORM_TRANSFER_HARD_LIMITS } from '../platform/bounded-transfer.ts';
import type { AudioDeviceKind } from '../platform/audio-device-port.ts';

export const NATIVE_AUDIO_DEVICE_ID_PREFIX = 'native';
export const NATIVE_AUDIO_MAXIMUM_DEVICES = 128;
export const NATIVE_AUDIO_MAXIMUM_LABEL_LENGTH = 256;

export type NativeAudioDirection = 'input' | 'output';
/** What main publishes per device. The handle is opaque and stays opaque. */
export type NativeAudioDeviceReport = Readonly<{ handle: string; label: string; direction: NativeAudioDirection | 'duplex'; channelCount?: number; isDefault?: boolean }>;
export type NativeAudioInventoryReport = Readonly<{ backend: string; status: string; detail: string; devices: readonly NativeAudioDeviceReport[] }>;
/** Deterministic per-device map: the index, and the even index of its pair. */
export type NativeAudioChannel = Readonly<{ index: number; pairStart: number | null }>;
/** The `state.recordingDevices` row shape, plus the native group and channel map. */
export type NativeAudioInputRow = Readonly<{ deviceId: string; groupId: string; label: string; isDefault: boolean; channelCount: number; status: 'available'; channels: readonly NativeAudioChannel[] }>;
/** The `state.audioOutputDevices` row shape, plus the native group. */
export type NativeAudioOutputRow = Readonly<{ deviceId: string; groupId: string; label: string; isDefault: boolean }>;
export type NativeAudioRejectedDevice = Readonly<{ label: string; reason: 'opaque-handle-required' | 'unknown-direction' | 'duplicate-identity' | 'malformed' }>;
export type NativeAudioInventory = Readonly<{ backend: string; status: string; detail: string; inputs: readonly NativeAudioInputRow[]; outputs: readonly NativeAudioOutputRow[]; rejected: readonly NativeAudioRejectedDevice[] }>;

/**
 * The identity the rest of the editor sees. It is derived only from what main
 * published — backend, direction and opaque handle — so the same device is the
 * same id on every enumeration and across restarts, and the renderer never
 * mints a device identity of its own. Both directions of one duplex device
 * share the group id, as `groupId` already means in the recording rows.
 */
export function nativeAudioDeviceId(backend: string, kind: AudioDeviceKind, handle: string): string {
	return `${NATIVE_AUDIO_DEVICE_ID_PREFIX}:${backend}:${kind === 'audio-input' ? 'in' : 'out'}:${handle}`;
}

export function nativeAudioDeviceGroupId(backend: string, handle: string): string {
	return `${NATIVE_AUDIO_DEVICE_ID_PREFIX}:${backend}:${handle}`;
}

export function nativeAudioChannelMap(channelCount: unknown): readonly NativeAudioChannel[] {
	const count = Number.isSafeInteger(channelCount) && (channelCount as number) > 0
		? Math.min(channelCount as number, PLATFORM_TRANSFER_HARD_LIMITS.audioChunkChannels)
		: 0;
	// Stereo routes must start on an even index, so the trailing channel of an
	// odd-width device has no partner rather than borrowing the one before it.
	return Object.freeze(Array.from({ length: count }, (_unused, index) => Object.freeze({
		index, pairStart: index % 2 === 0 ? (index + 1 < count ? index : null) : index - 1,
	})));
}

type AdmittedNativeAudioDevice = Readonly<{
	id: string; kind: AudioDeviceKind; handle: string; label: string;
	isDefault: boolean; channels: readonly NativeAudioChannel[];
}>;

/**
 * Devices are put in a total order derived only from their own content before
 * anything else looks at them, so enumeration order cannot change an id, a row,
 * a channel map or which of two colliding devices wins.
 */
export function adaptNativeAudioInventory(value: unknown): NativeAudioInventory {
	const report = plainRecord(value, 'A native audio inventory');
	const backend = boundedLabel(report.backend, 'backend');
	if (!backend) throw new TypeError('A native audio inventory must name its backend.');
	if (!Array.isArray(report.devices) || report.devices.length > NATIVE_AUDIO_MAXIMUM_DEVICES) {
		throw new RangeError('A native audio inventory must carry a bounded device list.');
	}
	const rejected: NativeAudioRejectedDevice[] = [];
	const admitted: AdmittedNativeAudioDevice[] = [];
	for (const candidate of report.devices as readonly unknown[]) {
		const device = candidate && typeof candidate === 'object' && !Array.isArray(candidate)
			? candidate as Readonly<Record<string, unknown>> : null;
		const labelValue = device?.label;
		const label = typeof labelValue === 'string'
			? labelValue.slice(0, NATIVE_AUDIO_MAXIMUM_LABEL_LENGTH) : '';
		const validLabel = typeof labelValue === 'string'
			&& labelValue.length <= NATIVE_AUDIO_MAXIMUM_LABEL_LENGTH;
		const handle = device?.handle;
		const direction = device?.direction;
		if (!device || !validLabel || typeof handle !== 'string' || !handle) {
			rejected.push(Object.freeze({ label, reason: 'malformed' as const }));
		}
		else if (direction !== 'input' && direction !== 'output' && direction !== 'duplex') {
			rejected.push(Object.freeze({ label, reason: 'unknown-direction' as const }));
		} else if (!isOpaqueNativeAudioHandle(handle)) {
			// A handle that reads as a filesystem path would carry a raw path
			// into renderer state through the device id. Refuse it, and say so.
			rejected.push(Object.freeze({ label, reason: 'opaque-handle-required' as const }));
		} else {
			const kinds: readonly AudioDeviceKind[] = direction === 'duplex'
				? ['audio-input', 'audio-output']
				: [direction === 'input' ? 'audio-input' : 'audio-output'];
			const channels = nativeAudioChannelMap(device.channelCount);
			for (const kind of kinds) {
				admitted.push(Object.freeze({
					id: nativeAudioDeviceId(backend, kind, handle), kind, handle, label,
					isDefault: device.isDefault === true, channels,
				}));
			}
		}
	}
	admitted.sort(compareAdmittedNativeAudioDevices);
	const inputs: NativeAudioInputRow[] = [];
	const outputs: NativeAudioOutputRow[] = [];
	const seen = new Set<string>();
	for (const entry of admitted) {
		if (seen.has(entry.id)) {
			rejected.push(Object.freeze({ label: entry.label, reason: 'duplicate-identity' as const }));
			continue;
		}
		seen.add(entry.id);
		const row = {
			deviceId: entry.id,
			groupId: nativeAudioDeviceGroupId(backend, entry.handle),
			label: entry.label,
			isDefault: entry.isDefault,
		};
		if (entry.kind === 'audio-output') outputs.push(Object.freeze(row));
		else {
			inputs.push(Object.freeze({
				...row, channelCount: entry.channels.length, status: 'available' as const, channels: entry.channels,
			}));
		}
	}
	rejected.sort((first, second) => compareNativeAudioText(first.reason + first.label, second.reason + second.label));
	return Object.freeze({
		backend,
		status: boundedLabel(report.status, 'status'),
		detail: typeof report.detail === 'string' ? report.detail.slice(0, 1_024) : '',
		inputs: Object.freeze(inputs),
		outputs: Object.freeze(outputs),
		rejected: Object.freeze(rejected),
	});
}

/**
 * A tie on the derived id is broken by the row the device would become — the
 * default first, then the widest, then the label — so a backend that publishes
 * one handle twice resolves to the same winner whatever order it listed them
 * in. Left to a stable sort the survivor would follow enumeration order, and
 * with it the channel map the editor saves routes against.
 */
function compareAdmittedNativeAudioDevices(first: AdmittedNativeAudioDevice, second: AdmittedNativeAudioDevice): number {
	if (first.id !== second.id) return compareNativeAudioText(first.id, second.id);
	if (first.isDefault !== second.isDefault) return first.isDefault ? -1 : 1;
	if (first.channels.length !== second.channels.length) return second.channels.length - first.channels.length;
	return compareNativeAudioText(first.label, second.label);
}

export function isOpaqueNativeAudioHandle(handle: string): boolean {
	return !handle.includes('\0') && !handle.includes('\\') && !handle.includes('/');
}

/** Code-unit order, so a device list does not reorder itself with the locale. */
export function compareNativeAudioText(first: string, second: string): number {
	return first < second ? -1 : first > second ? 1 : 0;
}

function plainRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be a plain record.`);
	return value as Readonly<Record<string, unknown>>;
}

function boundedLabel(value: unknown, field: string): string {
	if (value == null) return '';
	if (typeof value !== 'string' || value.length > NATIVE_AUDIO_MAXIMUM_LABEL_LENGTH) {
		throw new RangeError(`A native audio device ${field} must be bounded text.`);
	}
	return value;
}

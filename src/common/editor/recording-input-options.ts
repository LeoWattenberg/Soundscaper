/* SPDX-License-Identifier: AGPL-3.0-only */

/** Browser capabilities may be absent on hosts without capture or device enumeration. */
export type RecordingMediaDevices = Partial<Pick<MediaDevices,
	'getUserMedia' | 'getDisplayMedia' | 'enumerateDevices' | 'addEventListener' | 'removeEventListener'
>>;

export interface HardwareRecordingInputOptions {
	readonly deviceId?: string | null;
	readonly channelCount?: number;
	readonly sampleRate?: number;
	readonly audioConstraints?: MediaTrackConstraints;
	readonly mediaDevices?: RecordingMediaDevices;
}

export interface DisplayRecordingInputOptions {
	readonly audioConstraints?: boolean | MediaTrackConstraints;
	readonly videoConstraints?: boolean | MediaTrackConstraints;
	readonly displayConstraints?: Readonly<Record<string, unknown>>;
	readonly mediaDevices?: RecordingMediaDevices;
}

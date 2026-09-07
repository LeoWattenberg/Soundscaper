/* SPDX-License-Identifier: AGPL-3.0-only */

import { createRecordingCapturePool } from '../recording-capture-pool.js';
import { requestDisplayInput, requestHardwareInput } from '../recording-inputs.js';
import { RECORDING_DEFAULT_DEVICE_ID } from '../recording-routing.js';
import type { DisplayRecordingInputOptions, HardwareRecordingInputOptions, RecordingMediaDevices } from '../recording-input-options.ts';
import type { RecordingPoolSource } from './recording-input-coordination-service.ts';

interface RecordingCapturePoolBindingOptions {
	readonly pool?: ReturnType<typeof createRecordingCapturePool>;
	readonly mediaDevices?: RecordingMediaDevices;
	readonly onChange: (sources: readonly RecordingPoolSource[]) => void;
}

/** Bind capture to this controller's host and translate its default-device sentinel. */
export function createRecordingCapturePoolBinding(options: RecordingCapturePoolBindingOptions) {
	return options.pool || createRecordingCapturePool({
		requestHardwareInput: (capture: HardwareRecordingInputOptions) => requestHardwareInput({
			...capture,
			deviceId: capture.deviceId === RECORDING_DEFAULT_DEVICE_ID ? undefined : capture.deviceId,
			mediaDevices: options.mediaDevices,
		}),
		requestDisplayInput: (capture: DisplayRecordingInputOptions) => requestDisplayInput({
			...capture, mediaDevices: options.mediaDevices,
		}),
		onChange: options.onChange,
	});
}

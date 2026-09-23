/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	RECORDING_DEFAULT_DEVICE_ID,
	type RecordingRoute,
} from '../../../recording-routing.js';
import { createNonImportedSourceProvenance } from '../../../source-provenance-root.ts';

/** Keep the capture label needed for upload metadata without persisting a hardware identifier. */
export function recordedSourceProvenance(route: RecordingRoute) {
	return createNonImportedSourceProvenance('recorded', {
		recordingDeviceLabel: route.kind === 'device'
			&& route.deviceId !== RECORDING_DEFAULT_DEVICE_ID
			? route.deviceLabel
			: null,
	});
}

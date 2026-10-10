/* SPDX-License-Identifier: AGPL-3.0-only */

import { createRecordingController } from './recording.js';
import type { RecordingControllerFactory } from './controller/recording/recording-transaction-types.ts';

interface RecordingListeningEngine {
	getPlaybackDestination?(): unknown;
}

/** Keep captured PCM upstream of the device-only listening gain. */
export function createListeningRecordingControllerFactory(
	engine: RecordingListeningEngine,
	createRecorder: RecordingControllerFactory = createRecordingController,
): RecordingControllerFactory {
	return (request) => {
		const options = { ...request, monitorDestination: engine.getPlaybackDestination?.() };
		return createRecorder(options);
	};
}

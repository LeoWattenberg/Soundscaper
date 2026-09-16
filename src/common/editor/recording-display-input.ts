/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DisplayRecordingInputOptions } from './recording-input-options.ts';

interface RecordingCaptureController {
	setFocusBehavior(behavior: 'no-focus-change'): void;
}

function createCaptureController(): RecordingCaptureController | undefined {
	const host = globalThis as typeof globalThis & {
		CaptureController?: new () => RecordingCaptureController;
	};
	if (typeof host.CaptureController !== 'function') return undefined;
	try {
		const controller = new host.CaptureController();
		// Decide before opening the picker: switching to the captured surface
		// puts the audio editor in the background while its recorder is starting.
		controller.setFocusBehavior('no-focus-change');
		return controller;
	} catch {
		// Conditional focus is optional; older hosts must still be able to share.
		return undefined;
	}
}

/** Request desktop audio while keeping the editor focused and retaining video. */
export async function requestDisplayInput({
	audioConstraints = true,
	videoConstraints = true,
	displayConstraints = {},
	mediaDevices = globalThis.navigator?.mediaDevices,
}: DisplayRecordingInputOptions = {}): Promise<MediaStream> {
	if (!mediaDevices?.getDisplayMedia) {
		throw new Error('Desktop audio recording is not supported in this browser.');
	}
	const controller = createCaptureController();
	return mediaDevices.getDisplayMedia.call(mediaDevices, {
		...displayConstraints,
		...(controller ? { controller } : {}),
		video: videoConstraints || true,
		audio: audioConstraints || true,
		selfBrowserSurface: 'exclude',
		systemAudio: 'include',
		windowAudio: 'system',
	});
}

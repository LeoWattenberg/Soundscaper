/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	AudioEditorEngineDisposedError,
	getAudioContextConstructor,
} from './engine/lifecycle.ts';

export {
	createRecordingCapturePool,
	createRecordingController,
	requestDisplayInput,
	requestHardwareInput,
	requestMicrophone,
} from './recording.js';

export {
	applyEffectRack,
	effectRackLatencyFrames,
	PARAMETRIC_EQ_SPECTRUM_FFT_SIZE,
} from './engine/effect-rack.ts';
export {
	assertPlayAtSpeedStaffPadMemorySafe,
	estimatePlayAtSpeedStaffPadPeakBytes,
	getProjectDurationFrames,
	getProjectTimelineDurationFrames,
	PLAY_AT_SPEED_STAFFPAD_MEMORY_LIMIT_BYTES,
} from './engine/buffer-math.ts';
export { automaticCrossfadeRanges } from './engine/clip-schedule-plan.ts';
export { projectEffectRacks } from './engine/project-effects.ts';
export {
	buildProjectGraph,
	projectGraphLatencyFrames,
} from './engine/project-graph.ts';
export { AudioEditorEngineDisposedError };
export {
	createAudioEditorEngine,
	WebAudioEditorEngine,
} from './engine/runtime-class.ts';

export function isAudioEditorEngineSupported() {
	return Boolean(getAudioContextConstructor());
}

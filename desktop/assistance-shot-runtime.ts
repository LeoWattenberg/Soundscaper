/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed runtime boundary for authenticated, model-free shot detection. */

import type { SpeechRuntimeStatus } from './assistance-speech-runtime.ts';
import type { ExternalFfmpegShotDetectionResult } from './external-ffmpeg-shot-detection-output.ts';

export interface AssistanceShotDetectionRequest {
	readonly videoPath: string;
	readonly signal?: AbortSignal;
}

export interface AssistanceShotRuntimeAdapter {
	status(): Promise<SpeechRuntimeStatus>;
	/** Null means the runtime became unavailable while qualifying the executable pair. */
	detect(request: AssistanceShotDetectionRequest): Promise<ExternalFfmpegShotDetectionResult | null>;
}

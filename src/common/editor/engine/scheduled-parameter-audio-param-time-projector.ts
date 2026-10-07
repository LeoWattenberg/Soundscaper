/* SPDX-License-Identifier: AGPL-3.0-only */

interface AudioParamWindowTiming {
	readonly fromFrame: number;
	readonly contextStartTime: number;
	readonly sampleRate: number;
	readonly transportRate: number;
}

/** The registry owns normalized immutable window inputs and latency seconds. */
export function createScheduledParameterAudioParamTimeProjector(
	options: AudioParamWindowTiming,
	latencySeconds: number,
): (frame: number) => number {
	const contextStartTime = options.contextStartTime;
	const fromFrame = options.fromFrame;
	const framesPerSecond = options.sampleRate * options.transportRate;
	return frame => contextStartTime + (
		latencySeconds + (frame - fromFrame) / framesPerSecond
	);
}

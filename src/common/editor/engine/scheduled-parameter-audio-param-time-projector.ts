/* SPDX-License-Identifier: AGPL-3.0-only */

interface AudioParamWindowTiming {
	readonly fromFrame: number;
	readonly contextStartTime: number;
	readonly sampleRate: number;
	readonly transportRate: number;
}

interface PreparedAudioParamWindowTiming {
	readonly fromFrame: number;
	readonly contextStartTime: number;
	readonly framesPerSecond: number;
}

/** The registry owns normalized immutable window inputs and consumes these scalars once. */
export function prepareScheduledParameterAudioParamWindowTiming(
	options: AudioParamWindowTiming,
): PreparedAudioParamWindowTiming {
	return {
		contextStartTime: options.contextStartTime,
		fromFrame: options.fromFrame,
		framesPerSecond: options.sampleRate * options.transportRate,
	};
}

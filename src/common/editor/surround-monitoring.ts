/* SPDX-License-Identifier: AGPL-3.0-only */

interface SurroundDestination {
	readonly maxChannelCount?: number;
	channelCount?: number;
	channelCountMode?: string;
	channelInterpretation?: string;
}

export function configureNativeSurroundDestination(
	destination: SurroundDestination | null | undefined,
	channelCount: number,
): boolean {
	if (!destination || !Number.isInteger(channelCount) || channelCount < 1 || channelCount > 32) return false;
	if (!Number.isInteger(destination.maxChannelCount) || destination.maxChannelCount! < channelCount) return false;
	try {
		destination.channelCount = channelCount;
		destination.channelCountMode = 'explicit';
		destination.channelInterpretation = 'discrete';
		return destination.channelCount === channelCount;
	} catch {
		return false;
	}
}

export function downmixSurroundToStereo(
	input: readonly Float32Array[],
): readonly [Float32Array, Float32Array] {
	if (!Array.isArray(input) || input.length < 1) throw new TypeError('At least one monitoring channel is required.');
	const frameCount = input[0]?.length ?? 0;
	if (input.some((channel) => !(channel instanceof Float32Array) || channel.length !== frameCount)) {
		throw new TypeError('Monitoring channels must be aligned Float32 PCM.');
	}
	if (input.length === 1) return [input[0].slice(), input[0].slice()];
	if (input.length === 2) return [input[0].slice(), input[1].slice()];
	if (input.length !== 6) throw new RangeError('Monitoring supports mono, stereo, or the L/R/C/LFE/Ls/Rs 5.1 order.');
	const left = new Float32Array(frameCount);
	const right = new Float32Array(frameCount);
	const relatedGain = Math.SQRT1_2 * 0.5;
	for (let frame = 0; frame < frameCount; frame += 1) {
		left[frame] = input[0][frame] * 0.5 + input[2][frame] * relatedGain + input[4][frame] * relatedGain;
		right[frame] = input[1][frame] * 0.5 + input[2][frame] * relatedGain + input[5][frame] * relatedGain;
	}
	return [left, right];
}

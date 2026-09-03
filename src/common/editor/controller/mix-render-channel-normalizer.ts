/* SPDX-License-Identifier: AGPL-3.0-only */

export interface MixRenderPacketSink {
	write(channels: Float32Array[]): Promise<unknown> | unknown;
}

export interface NormalizingMixRenderPacketSink extends MixRenderPacketSink {
	readonly inputChannelCount: number;
}

/** Normalize one aligned PCM packet to an exact supported Mix and Render width. */
export function normalizeMixRenderChannels(
	channels: readonly Float32Array[],
	outputChannelCount: number,
	invalidAudio: () => Error,
): Float32Array[] {
	if (!Number.isSafeInteger(outputChannelCount) || outputChannelCount < 1 || outputChannelCount > 32
		|| !Array.isArray(channels) || !channels.length || channels.length > 32
		|| !(channels[0] instanceof Float32Array) || !channels[0].length
		|| channels.some((channel) => !(channel instanceof Float32Array)
			|| channel.length !== channels[0]!.length)) throw invalidAudio();
	if (channels.length === outputChannelCount) return [...channels];
	if (outputChannelCount === 2) return foldToStereo(channels);
	if (outputChannelCount === 1) {
		const [left, right] = foldToStereo(channels);
		const mono = new Float32Array(left.length);
		for (let frame = 0; frame < mono.length; frame += 1) {
			mono[frame] = (left[frame]! + right[frame]!) * Math.SQRT1_2;
		}
		return [mono];
	}
	throw invalidAudio();
}

/** Apply the same exact-width normalization used by buffered Mix and Render. */
export function createNormalizingMixRenderPacketSink(
	sink: MixRenderPacketSink,
	outputChannelCount: number,
	invalidAudio: () => Error,
): Readonly<NormalizingMixRenderPacketSink> {
	let inputChannelCount = 0;
	return Object.freeze({
		get inputChannelCount() { return inputChannelCount; },
		async write(channels: Float32Array[]): Promise<void> {
			const normalized = normalizeMixRenderChannels(channels, outputChannelCount, invalidAudio);
			inputChannelCount ||= channels.length;
			if (channels.length !== inputChannelCount) throw invalidAudio();
			await sink.write(normalized);
		},
	});
}

function foldToStereo(channels: readonly Float32Array[]): [Float32Array, Float32Array] {
	const frameCount = channels[0]!.length;
	if (channels.length === 1) return [channels[0]!.slice(), channels[0]!.slice()];
	if (channels.length === 2) return [channels[0]!, channels[1]!];
	const left = new Float32Array(frameCount);
	const right = new Float32Array(frameCount);
	mixInto(left, channels[0]!, 1);
	mixInto(right, channels[1]!, 1);
	if (channels.length === 3 || channels.length >= 5) {
		mixInto(left, channels[2]!, Math.SQRT1_2);
		mixInto(right, channels[2]!, Math.SQRT1_2);
	} else {
		mixInto(left, channels[2]!, Math.SQRT1_2);
		mixInto(right, channels[3]!, Math.SQRT1_2);
	}
	if (channels.length === 5) {
		mixInto(left, channels[3]!, Math.SQRT1_2);
		mixInto(right, channels[4]!, Math.SQRT1_2);
	} else if (channels.length >= 6) {
		mixInto(left, channels[3]!, 0.5);
		mixInto(right, channels[3]!, 0.5);
		mixInto(left, channels[4]!, Math.SQRT1_2);
		mixInto(right, channels[5]!, Math.SQRT1_2);
		for (let channel = 6; channel < channels.length; channel += 1) {
			mixInto(channel % 2 === 0 ? left : right, channels[channel]!, 0.5);
		}
	}
	return [left, right];
}

function mixInto(output: Float32Array, input: Float32Array, gain: number): void {
	for (let frame = 0; frame < output.length; frame += 1) {
		output[frame] += input[frame]! * gain;
	}
}

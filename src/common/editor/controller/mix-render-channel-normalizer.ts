/* SPDX-License-Identifier: AGPL-3.0-only */

export interface MixRenderPacketSink {
	write(channels: Float32Array[]): Promise<unknown> | unknown;
}

export interface NormalizingMixRenderPacketSink extends MixRenderPacketSink {
	readonly inputChannelCount: number;
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
			if (!Array.isArray(channels) || !channels.length || channels.length > 32
				|| !(channels[0] instanceof Float32Array) || !channels[0].length
				|| channels.some((channel) => !(channel instanceof Float32Array)
					|| channel.length !== channels[0]!.length)) throw invalidAudio();
			inputChannelCount ||= channels.length;
			if (channels.length !== inputChannelCount) throw invalidAudio();
			if (channels.length === outputChannelCount) {
				await sink.write(channels);
				return;
			}
			if (outputChannelCount !== 1 || channels.length !== 2) throw invalidAudio();
			const mono = new Float32Array(channels[0].length);
			for (let frame = 0; frame < mono.length; frame += 1) {
				mono[frame] = (channels[0][frame]! + channels[1][frame]!) * Math.SQRT1_2;
			}
			await sink.write([mono]);
		},
	});
}

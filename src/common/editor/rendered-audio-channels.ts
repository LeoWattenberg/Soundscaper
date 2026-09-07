/* SPDX-License-Identifier: AGPL-3.0-only */

export type PlanarPcm = Readonly<{
	channels: readonly (Float32Array | ArrayLike<number>)[];
}>;

export interface AudioChannelBuffer {
	readonly numberOfChannels: number;
	getChannelData(channel: number): Float32Array;
}

export type RenderedAudio = AudioChannelBuffer | PlanarPcm;

/** Read either renderer representation, retaining borrowed Float32Array views. */
export function audioBufferChannels(buffer: RenderedAudio): Float32Array[] {
	if ('channels' in buffer && Array.isArray(buffer.channels)) {
		return buffer.channels.map(channel => channel instanceof Float32Array ? channel : new Float32Array(channel));
	}
	if (!('getChannelData' in buffer) || typeof buffer.getChannelData !== 'function') {
		throw new TypeError('Rendered audio requires PCM channels.');
	}
	const channelCount = Number.isFinite(buffer.numberOfChannels) ? Math.max(0, Math.floor(buffer.numberOfChannels)) : 0;
	if (!channelCount) throw new TypeError('Rendered audio requires PCM channels.');
	return Array.from({ length: channelCount }, (_, channel) => buffer.getChannelData(channel));
}

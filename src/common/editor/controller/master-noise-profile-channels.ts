/* SPDX-License-Identifier: AGPL-3.0-only */

export function masterNoiseProfileChannelCount(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 32) {
		throw new RangeError('The master noise profile requires a project channel count from 1 to 32.');
	}
	return value;
}

export function copyMasterNoiseProfileChannels(
	channels: readonly Float32Array[],
	expectedChannelCount: number,
): Float32Array[] {
	if (!Array.isArray(channels) || channels.length !== expectedChannelCount) {
		throw new RangeError(`The master noise profile expected ${String(expectedChannelCount)} rendered channels.`);
	}
	const frameCount = channels[0]?.length;
	if (!Number.isSafeInteger(frameCount) || channels.some((channel) => (
		!(channel instanceof Float32Array) || channel.length !== frameCount
	))) {
		throw new RangeError('The master noise profile render produced mismatched PCM channels.');
	}
	return channels.map((channel) => channel.slice());
}

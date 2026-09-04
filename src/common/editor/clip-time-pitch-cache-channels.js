/* SPDX-License-Identifier: AGPL-3.0-only */

// Reading a stored source back as exact planar PCM, and refusing anything that
// is not. The coordinator hands StaffPad Float32 channels that own their whole
// buffer so the render can transfer them, so both the PCM read out of storage
// and the PCM handed back by the worker are checked against the plan's declared
// allocation. Split out of clip-time-pitch-cache.js; no behaviour changes here.

import { cacheError, throwIfAborted } from './clip-time-pitch-cache-errors.js';
import { integerRange, positiveInteger } from './clip-time-pitch-cache-validation.ts';

export async function loadStoredSourceChannels(store, source, options = {}) {
	if (!store?.readSourceChunks) throw new TypeError('The project store cannot read source chunks.');
	const frameCount = positiveInteger(source.frameCount, 'source.frameCount');
	const channelCount = integerRange(source.channelCount, 1, 2, 'source.channelCount');
	const channels = Array.from({ length: channelCount }, () => new Float32Array(frameCount));
	let offset = 0;
	for await (const chunk of store.readSourceChunks(source.storageKey || source.id)) {
		throwIfAborted(options.signal);
		if (!Array.isArray(chunk.channels) || chunk.channels.length !== channelCount) {
			throw cacheError('CORRUPT_SOURCE', 'A stored source chunk has an invalid channel count.');
		}
		const frames = positiveInteger(chunk.frames ?? chunk.channels[0]?.length, 'source chunk frames');
		if (offset + frames > frameCount) throw cacheError('CORRUPT_SOURCE', 'Stored source chunks exceed their declared frame count.');
		for (let channel = 0; channel < channelCount; channel += 1) {
			if (!(chunk.channels[channel] instanceof Float32Array) || chunk.channels[channel].length !== frames) {
				throw cacheError('CORRUPT_SOURCE', 'A stored source chunk contains invalid planar PCM.');
			}
			channels[channel].set(chunk.channels[channel], offset);
		}
		offset += frames;
	}
	if (offset !== frameCount) throw cacheError('CORRUPT_SOURCE', 'Stored source chunks do not match their declared frame count.');
	return channels;
}

export function normalizeLoadedChannels(value, plan) {
	const channels = isAudioBufferLike(value)
		? Array.from({ length: value.numberOfChannels }, (_, channel) => value.getChannelData(channel))
		: value;
	if (!Array.isArray(channels) || channels.length !== plan.channelCount) {
		throw cacheError('SOURCE_CHANNEL_MISMATCH', 'Loaded source PCM does not match the V2 source channel count.');
	}
	return channels.map((channel, index) => {
		if (!(channel instanceof Float32Array) || channel.length !== plan.sourceFrameCount
			|| channel.byteOffset !== 0 || channel.byteLength !== channel.buffer.byteLength) {
			throw cacheError('SOURCE_FRAME_MISMATCH', `Loaded source channel ${index} does not have the exact V2 source allocation.`);
		}
		return channel;
	});
}

export function validateRenderedChannels(channels, channelCount, frameCount) {
	if (!Array.isArray(channels) || channels.length !== channelCount) {
		throw cacheError('INVALID_RENDER_OUTPUT', 'StaffPad returned an invalid channel count.');
	}
	return channels.map((channel, index) => {
		if (!(channel instanceof Float32Array) || channel.length !== frameCount
			|| channel.byteOffset !== 0 || channel.byteLength !== channel.buffer.byteLength) {
			throw cacheError('INVALID_RENDER_OUTPUT', `StaffPad returned an invalid channel ${index}.`);
		}
		return channel;
	});
}

export function isAudioBufferLike(value) {
	return Boolean(value && Number.isSafeInteger(value.numberOfChannels) && value.numberOfChannels > 0
		&& Number.isSafeInteger(value.length) && value.length > 0
		&& typeof value.getChannelData === 'function');
}

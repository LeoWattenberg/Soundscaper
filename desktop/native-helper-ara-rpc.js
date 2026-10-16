/* SPDX-License-Identifier: AGPL-3.0-only */

/** ARA control messages never pass through the realtime audio worklet. */
export function createAraPluginRpc(addon, instance) {
	let source = null;
	let nextFrame = 0;
	let bound = false;
	return async (message) => {
		const requestId = identifier(message.requestId);
		const result = (value = {}) => ({ protocolVersion: 1, kind: message.kind, requestId, ...value });
		if (message.kind === 'ara-capabilities') {
			const answer = await addon.araCapabilities?.(instance);
			return result({ supported: answer?.supported === true });
		}
		if (message.kind === 'ara-configure') {
			if (source !== null) throw new Error('ARA source is already configured.');
			const value = message.source;
			if (!value || typeof value !== 'object') throw new TypeError('ARA source is required.');
			const channelCount = integer(value.channelCount, 1, 2);
			const frameCount = integer(value.frameCount, 1, Math.floor(512 * 1024 ** 2 / (channelCount * 4)));
			const sampleRate = integer(value.sampleRate, 8000, 768000);
			if (typeof value.name !== 'string' || value.name.length === 0 || Buffer.byteLength(value.name) > 511 || value.name.includes('\0')
				|| value.sourceStartSeconds !== 0 || !Number.isFinite(value.playbackStartSeconds)
				|| value.playbackStartSeconds < 0 || value.playbackStartSeconds > 86400
				|| !Number.isFinite(value.durationSeconds)
				|| Math.abs(value.durationSeconds * sampleRate - frameCount) > 0.0001) {
				throw new TypeError('ARA source geometry is invalid.');
			}
			source = { sourceId: identifier(value.sourceId), name: value.name, channelCount,
				frameCount, sampleRate, sourceStartSeconds: 0, playbackStartSeconds: value.playbackStartSeconds,
				durationSeconds: value.durationSeconds };
			if (await addon.configureAra(instance, source) !== true) throw new Error('ARA source was refused.');
			return result();
		}
		if (source === null) throw new Error('ARA source is not configured.');
		if (message.kind === 'ara-write') {
			if (bound || message.startFrame !== nextFrame) throw new Error('ARA PCM must be contiguous and unbound.');
			const channels = planes(message.channels, source.channelCount);
			const frames = channels[0].length;
			if (nextFrame + frames > source.frameCount) throw new RangeError('ARA PCM exceeds the source.');
			if (await addon.writeAraPcm(instance, { startFrame: nextFrame, channels }) !== true) {
				throw new Error('ARA PCM was refused.');
			}
			nextFrame += frames;
			return result();
		}
		if (message.kind === 'ara-bind') {
			if (bound || nextFrame !== source.frameCount) throw new Error('ARA source is incomplete or already bound.');
			if (await addon.bindAra(instance) !== true) throw new Error('ARA binding was refused.');
			bound = true;
			return result();
		}
		if (message.kind === 'ara-render') {
			if (!bound) throw new Error('ARA source is not bound.');
			const startFrame = integer(message.startFrame, 0, source.frameCount - 1);
			const frameCount = integer(message.frameCount, 1, Math.min(65536, source.frameCount - startFrame));
			let answer;
			try { answer = await addon.renderAra(instance, { startFrame, frameCount, channelCount: source.channelCount }); }
			catch (error) {
				if (error?.code === 'ara-analysis-incomplete') return result({ analysisPending: true });
				throw error;
			}
			const channels = planes(answer?.channels, source.channelCount, frameCount);
			return result({ startFrame, channels });
		}
		throw new TypeError('Unknown ARA operation.');
	};
}

function identifier(value) {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value)) {
		throw new TypeError('ARA identifier is invalid.');
	}
	return value;
}

function integer(value, minimum, maximum) {
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError('ARA integer is invalid.');
	return value;
}

function planes(value, channelCount, frameCount = null) {
	if (!Array.isArray(value) || value.length !== channelCount) throw new TypeError('ARA PCM channels are invalid.');
	const buffers = new Set();
	for (const channel of value) {
		if (!(channel instanceof Float32Array) || !(channel.buffer instanceof ArrayBuffer)
			|| buffers.has(channel.buffer)) throw new TypeError('ARA PCM must use ordinary distinct planes.');
		buffers.add(channel.buffer);
		integer(channel.length, 1, 65536);
		frameCount ??= channel.length;
		if (channel.length !== frameCount) throw new RangeError('ARA PCM lengths are invalid.');
		for (const sample of channel) if (!Number.isFinite(sample)) throw new TypeError('ARA PCM must be finite.');
	}
	return value;
}

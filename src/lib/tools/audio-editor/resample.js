/**
 * Bounded, stateful linear resampler for recordings and streamed renders. It
 * retains only the interpolation boundary between chunks and preserves the
 * exact long-term frame ratio across arbitrary chunk sizes.
 */
export function createStreamingLinearResampler(inputSampleRate, outputSampleRate, channelCount) {
	const inputRate = Math.max(1, Math.round(inputSampleRate));
	const outputRate = Math.max(1, Math.round(outputSampleRate));
	const channels = Math.max(1, Math.floor(channelCount));
	const step = inputRate / outputRate;
	let totalInputFrames = 0;
	let totalOutputFrames = 0;
	let nextInputPosition = 0;
	let carryStartFrame = 0;
	let carry = emptyChannels(channels);
	let lastSamples = new Float32Array(channels);

	return { push, finish };

	function push(inputChannels) {
		if (!Array.isArray(inputChannels) || inputChannels.length !== channels) throw new RangeError('Recording channel count changed.');
		const frameCount = inputChannels[0]?.length || 0;
		if (inputChannels.some((channel) => !(channel instanceof Float32Array) || channel.length !== frameCount)) {
			throw new RangeError('Audio chunks must contain equally sized Float32 channels.');
		}
		if (!frameCount) return emptyChannels(channels);
		for (let channel = 0; channel < channels; channel += 1) lastSamples[channel] = inputChannels[channel][frameCount - 1];
		if (inputRate === outputRate) {
			totalInputFrames += frameCount;
			totalOutputFrames += frameCount;
			return inputChannels;
		}

		const carryLength = carry[0].length;
		const baseFrame = carryLength ? carryStartFrame : totalInputFrames;
		const combined = Array.from({ length: channels }, (_, channel) => {
			const values = new Float32Array(carryLength + frameCount);
			values.set(carry[channel]);
			values.set(inputChannels[channel], carryLength);
			return values;
		});
		totalInputFrames += frameCount;
		const capacity = Math.max(0, Math.ceil((combined[0].length + 1) * outputRate / inputRate));
		const output = Array.from({ length: channels }, () => new Float32Array(capacity));
		let written = 0;
		const endFrameExclusive = baseFrame + combined[0].length;
		while (Math.floor(nextInputPosition) + 1 < endFrameExclusive) {
			const firstFrame = Math.floor(nextInputPosition);
			const fraction = nextInputPosition - firstFrame;
			const firstIndex = firstFrame - baseFrame;
			for (let channel = 0; channel < channels; channel += 1) {
				const first = combined[channel][firstIndex];
				const second = combined[channel][firstIndex + 1];
				output[channel][written] = first + (second - first) * fraction;
			}
			written += 1;
			nextInputPosition += step;
		}
		totalOutputFrames += written;
		const keepIndex = Math.max(0, Math.min(combined[0].length - 1, Math.floor(nextInputPosition) - baseFrame));
		carryStartFrame = baseFrame + keepIndex;
		carry = combined.map((values) => values.slice(keepIndex));
		return output.map((values) => values.slice(0, written));
	}

	function finish(requestedOutputFrames = null) {
		if (!totalInputFrames) return emptyChannels(channels);
		const naturalExpectedFrames = Math.round(totalInputFrames * outputRate / inputRate);
		const expectedFrames = requestedOutputFrames == null
			? naturalExpectedFrames
			: Math.max(totalOutputFrames, Math.round(requestedOutputFrames));
		const interpolationFrames = Math.max(0, Math.min(naturalExpectedFrames, expectedFrames) - totalOutputFrames);
		const remaining = Math.max(0, expectedFrames - totalOutputFrames);
		totalOutputFrames += remaining;
		return Array.from({ length: channels }, (_, channel) => {
			const output = new Float32Array(remaining);
			output.fill(lastSamples[channel], 0, interpolationFrames);
			return output;
		});
	}
}

function emptyChannels(channelCount) {
	return Array.from({ length: channelCount }, () => new Float32Array(0));
}

/**
 * Bounded streaming windowed-sinc resampler used by V2 recording and export.
 * It retains only one input chunk plus the convolution history/look-ahead and
 * therefore does not reintroduce a full-source buffer requirement.
 */
export function createStreamingWindowedSincResampler(inputSampleRate, outputSampleRate, channelCount, options = {}) {
	const inputRate = positiveRate(inputSampleRate, 'inputSampleRate');
	const outputRate = positiveRate(outputSampleRate, 'outputSampleRate');
	const channels = positiveChannelCount(channelCount);
	const radius = Math.max(8, Math.min(64, Math.round(Number(options.radius) || 24)));
	const step = inputRate / outputRate;
	const cutoff = Math.min(1, outputRate / inputRate) * 0.94;
	const initialInputPosition = Number(options.initialInputPosition ?? 0);
	if (!Number.isFinite(initialInputPosition) || initialInputPosition < 0) {
		throw new RangeError('initialInputPosition must be finite and non-negative.');
	}
	let buffered = emptyChannels(channels);
	let bufferStartFrame = 0;
	let totalInputFrames = 0;
	let totalOutputFrames = 0;
	let nextInputPosition = initialInputPosition;
	let finished = false;

	return Object.freeze({
		push,
		finish,
		get latencyInputFrames() { return radius; },
		get inputFrames() { return totalInputFrames; },
		get outputFrames() { return totalOutputFrames; },
	});

	function push(inputChannels) {
		if (finished) throw new Error('The streaming resampler is finished.');
		const normalized = validateStreamingChannels(inputChannels, channels);
		const frameCount = normalized[0]?.length || 0;
		if (!frameCount) return emptyChannels(channels);
		buffered = appendChannels(buffered, normalized);
		totalInputFrames += frameCount;
		return produce(false);
	}

	function finish(requestedOutputFrames = null) {
		if (finished) return emptyChannels(channels);
		finished = true;
		const naturalFrames = Math.max(0, Math.round((totalInputFrames - initialInputPosition) * outputRate / inputRate));
		const targetFrames = requestedOutputFrames == null
			? naturalFrames
			: Math.max(totalOutputFrames, Math.round(Number(requestedOutputFrames)));
		if (!Number.isSafeInteger(targetFrames) || targetFrames < 0) {
			throw new RangeError('Requested resampler output length is invalid.');
		}
		return produce(true, targetFrames);
	}

	function produce(flush, targetFrames = Number.POSITIVE_INFINITY) {
		const remainingTarget = Math.max(0, targetFrames - totalOutputFrames);
		const availableEnd = flush ? totalInputFrames : totalInputFrames - radius;
		const estimated = Number.isFinite(targetFrames)
			? remainingTarget
			: Math.max(0, Math.ceil((availableEnd - nextInputPosition) / step));
		const output = Array.from({ length: channels }, () => new Float32Array(estimated));
		let written = 0;
		while (written < estimated && nextInputPosition < availableEnd && totalOutputFrames + written < targetFrames) {
			for (let channel = 0; channel < channels; channel += 1) {
				output[channel][written] = sincSample(buffered[channel], bufferStartFrame, totalInputFrames, nextInputPosition, radius, cutoff);
			}
			written += 1;
			nextInputPosition += step;
		}
		if (flush && written < estimated) {
			// An explicitly longer output is a requested tail; it is silence rather
			// than an extrapolation of the last sample.
			written = estimated;
		}
		totalOutputFrames += written;
		pruneHistory();
		return output.map((values) => written === values.length ? values : values.slice(0, written));
	}

	function pruneHistory() {
		const retainFrom = Math.max(bufferStartFrame, Math.floor(nextInputPosition) - radius - 1);
		const dropFrames = retainFrom - bufferStartFrame;
		if (dropFrames <= 0) return;
		buffered = buffered.map((values) => values.slice(Math.min(values.length, dropFrames)));
		bufferStartFrame = retainFrom;
	}
}

function sincSample(values, bufferStartFrame, inputEndFrame, position, radius, cutoff) {
	const center = Math.floor(position);
	let weighted = 0;
	let weightSum = 0;
	for (let frame = center - radius + 1; frame <= center + radius; frame += 1) {
		if (frame < 0 || frame >= inputEndFrame) continue;
		const distance = position - frame;
		const normalizedDistance = Math.abs(distance) / radius;
		if (normalizedDistance >= 1) continue;
		const window = 0.5 + 0.5 * Math.cos(Math.PI * normalizedDistance);
		const argument = Math.PI * distance * cutoff;
		const sinc = argument === 0 ? 1 : Math.sin(argument) / argument;
		const weight = cutoff * sinc * window;
		const index = frame - bufferStartFrame;
		if (index < 0 || index >= values.length) continue;
		weighted += values[index] * weight;
		weightSum += weight;
	}
	return weightSum ? weighted / weightSum : 0;
}

function appendChannels(previous, next) {
	return previous.map((values, channel) => {
		const combined = new Float32Array(values.length + next[channel].length);
		combined.set(values);
		combined.set(next[channel], values.length);
		return combined;
	});
}

function validateStreamingChannels(values, channelCount) {
	if (!Array.isArray(values) || values.length !== channelCount) {
		throw new RangeError('Audio channel count changed while resampling.');
	}
	const frameCount = values[0]?.length || 0;
	if (values.some((channel) => !(channel instanceof Float32Array) || channel.length !== frameCount)) {
		throw new RangeError('Audio chunks must contain equally sized Float32 channels.');
	}
	return values;
}

function positiveRate(value, name) {
	const number = Number(value);
	if (!Number.isFinite(number) || number <= 0) throw new RangeError(`${name} must be positive.`);
	return number;
}

function positiveChannelCount(value) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number <= 0 || number > 64) throw new RangeError('channelCount is invalid.');
	return number;
}

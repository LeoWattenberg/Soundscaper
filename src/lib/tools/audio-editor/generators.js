export const AUDIO_EDITOR_GENERATOR_TYPES = Object.freeze(['silence', 'tone', 'chirp', 'noise', 'dtmf']);

const DTMF_FREQUENCIES = Object.freeze({
	'1': [697, 1209], '2': [697, 1336], '3': [697, 1477], A: [697, 1633],
	'4': [770, 1209], '5': [770, 1336], '6': [770, 1477], B: [770, 1633],
	'7': [852, 1209], '8': [852, 1336], '9': [852, 1477], C: [852, 1633],
	'*': [941, 1209], '0': [941, 1336], '#': [941, 1477], D: [941, 1633],
});

/** Generate browser-native equivalents of Audacity's built-in generators. */
export function generateAudioEditorSignal(type, options = {}) {
	if (!AUDIO_EDITOR_GENERATOR_TYPES.includes(type)) throw new RangeError(`Unsupported audio generator: ${type}.`);
	const sampleRate = positiveInteger(options.sampleRate ?? 48_000, 'sampleRate');
	const channelCount = integerInRange(options.channelCount ?? 1, 1, 32, 'channelCount');
	const result = type === 'dtmf'
		? generateDtmf(options, sampleRate, channelCount)
		: generateFixedDuration(type, options, sampleRate, channelCount);
	return Object.freeze({
		type,
		sampleRate,
		channelCount,
		frameCount: result[0].length,
		channels: Object.freeze(result),
	});
}

function generateFixedDuration(type, options, sampleRate, channelCount) {
	const durationSeconds = finiteInRange(options.durationSeconds ?? 1, 1 / sampleRate, 24 * 60 * 60, 'durationSeconds');
	const frameCount = boundedFrameCount(durationSeconds, sampleRate);
	const amplitude = finiteInRange(options.amplitude ?? 0.8, 0, 1, 'amplitude');
	if (type === 'silence') return allocate(channelCount, frameCount);
	if (type === 'tone') {
		const frequency = finiteInRange(options.frequency ?? 440, 0.01, sampleRate / 2, 'frequency');
		const waveform = enumValue(options.waveform ?? 'sine', ['sine', 'square', 'sawtooth'], 'waveform');
		return duplicateChannels(renderTone(frameCount, sampleRate, frequency, amplitude, waveform), channelCount);
	}
	if (type === 'chirp') {
		const startFrequency = finiteInRange(options.startFrequency ?? 440, 0.01, sampleRate / 2, 'startFrequency');
		const endFrequency = finiteInRange(options.endFrequency ?? 1_320, 0.01, sampleRate / 2, 'endFrequency');
		const interpolation = enumValue(options.interpolation ?? 'logarithmic', ['linear', 'logarithmic'], 'interpolation');
		return duplicateChannels(renderChirp(frameCount, sampleRate, startFrequency, endFrequency, amplitude, interpolation), channelCount);
	}
	return renderNoise(frameCount, channelCount, amplitude, options);
}

function renderTone(frameCount, sampleRate, frequency, amplitude, waveform) {
	const output = new Float32Array(frameCount);
	let phase = 0;
	const step = frequency / sampleRate;
	for (let frame = 0; frame < frameCount; frame += 1) {
		output[frame] = amplitude * oscillator(phase, waveform);
		phase = (phase + step) % 1;
	}
	return output;
}

function renderChirp(frameCount, sampleRate, startFrequency, endFrequency, amplitude, interpolation) {
	const output = new Float32Array(frameCount);
	let phase = 0;
	for (let frame = 0; frame < frameCount; frame += 1) {
		const progress = frameCount <= 1 ? 0 : frame / (frameCount - 1);
		const frequency = interpolation === 'linear'
			? startFrequency + (endFrequency - startFrequency) * progress
			: startFrequency * (endFrequency / startFrequency) ** progress;
		output[frame] = amplitude * Math.sin(phase * Math.PI * 2);
		phase = (phase + frequency / sampleRate) % 1;
	}
	return output;
}

function renderNoise(frameCount, channelCount, amplitude, options) {
	const color = enumValue(options.color ?? 'white', ['white', 'pink', 'brown'], 'color');
	let state = (Number(options.seed ?? 0x6d2b79f5) >>> 0) || 1;
	return Array.from({ length: channelCount }, () => {
		const output = new Float32Array(frameCount);
		let brown = 0;
		const pinkBins = new Float64Array(7);
		let counter = 0;
		for (let frame = 0; frame < frameCount; frame += 1) {
			const white = randomSigned();
			if (color === 'white') output[frame] = white * amplitude;
			else if (color === 'brown') {
				brown = Math.max(-1, Math.min(1, brown * 0.995 + white * 0.05));
				output[frame] = brown * amplitude;
			} else {
				counter += 1;
				let zeroes = 0;
				let value = counter;
				while ((value & 1) === 0 && zeroes < pinkBins.length) { zeroes += 1; value >>= 1; }
				if (zeroes < pinkBins.length) pinkBins[zeroes] = white;
				output[frame] = Math.max(-1, Math.min(1, (pinkBins.reduce((sum, bin) => sum + bin, 0) + white) / 4)) * amplitude;
			}
		}
		return output;
	});

	function randomSigned() {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		return (state >>> 0) / 0x8000_0000 - 1;
	}
}

function generateDtmf(options, sampleRate, channelCount) {
	const sequence = String(options.sequence ?? '123').toUpperCase().replace(/[\s,-]+/g, '');
	if (!sequence.length || [...sequence].some((symbol) => !DTMF_FREQUENCIES[symbol])) {
		throw new RangeError('DTMF sequence contains an unsupported symbol.');
	}
	const toneSeconds = finiteInRange(options.toneSeconds ?? 0.1, 1 / sampleRate, 60, 'toneSeconds');
	const silenceSeconds = finiteInRange(options.silenceSeconds ?? 0.05, 0, 60, 'silenceSeconds');
	const amplitude = finiteInRange(options.amplitude ?? 0.8, 0, 1, 'amplitude');
	const toneFrames = boundedFrameCount(toneSeconds, sampleRate);
	const silenceFrames = Math.round(silenceSeconds * sampleRate);
	const frameCount = sequence.length * toneFrames + Math.max(0, sequence.length - 1) * silenceFrames;
	if (!Number.isSafeInteger(frameCount) || frameCount <= 0 || frameCount > 0x7fff_ffff) throw new RangeError('DTMF output is too large.');
	const mono = new Float32Array(frameCount);
	const fadeFrames = Math.min(Math.round(sampleRate * 0.005), Math.floor(toneFrames / 2));
	let offset = 0;
	for (const symbol of sequence) {
		const [low, high] = DTMF_FREQUENCIES[symbol];
		for (let frame = 0; frame < toneFrames; frame += 1) {
			const fade = fadeFrames
				? Math.min(1, (frame + 1) / fadeFrames, (toneFrames - frame) / fadeFrames)
				: 1;
			mono[offset + frame] = amplitude * fade * 0.5 * (
				Math.sin(2 * Math.PI * low * frame / sampleRate)
				+ Math.sin(2 * Math.PI * high * frame / sampleRate)
			);
		}
		offset += toneFrames + silenceFrames;
	}
	return duplicateChannels(mono, channelCount);
}

function oscillator(phase, waveform) {
	if (waveform === 'square') return phase < 0.5 ? 1 : -1;
	if (waveform === 'sawtooth') return phase * 2 - 1;
	return Math.sin(phase * Math.PI * 2);
}

function duplicateChannels(mono, channelCount) {
	return Array.from({ length: channelCount }, () => new Float32Array(mono));
}

function allocate(channelCount, frameCount) {
	return Array.from({ length: channelCount }, () => new Float32Array(frameCount));
}

function boundedFrameCount(seconds, sampleRate) {
	const frames = Math.round(seconds * sampleRate);
	if (!Number.isSafeInteger(frames) || frames <= 0 || frames > 0x7fff_ffff) throw new RangeError('Generator output is too large.');
	return frames;
}

function finiteInRange(value, minimum, maximum, name) {
	const number = Number(value);
	if (!Number.isFinite(number) || number < minimum || number > maximum) throw new RangeError(`${name} must be between ${minimum} and ${maximum}.`);
	return number;
}

function positiveInteger(value, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number <= 0) throw new RangeError(`${name} must be a positive safe integer.`);
	return number;
}

function integerInRange(value, minimum, maximum, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new RangeError(`${name} must be between ${minimum} and ${maximum}.`);
	return number;
}

function enumValue(value, allowed, name) {
	if (!allowed.includes(value)) throw new RangeError(`${name} must be one of: ${allowed.join(', ')}.`);
	return value;
}

/* SPDX-License-Identifier: AGPL-3.0-only */

/** Deterministic, model-free inputs for future source-framework parity runs. */

const AUDIO_GENERATORS = Object.freeze({
	'tiger-dnr-audio-v1': Object.freeze({
		id: 'tiger-dnr-audio-v1', version: 1,
		parameters: Object.freeze({
			sampleRateHz: 44_100, channels: 2, frameCount: 88_200,
			pattern: 'stereo-dialogue-effects-music-integer-v1',
		}),
	}),
	'panns-cnn10-audio-v1': Object.freeze({
		id: 'panns-cnn10-audio-v1', version: 1,
		parameters: Object.freeze({
			sampleRateHz: 32_000, channels: 1, frameCount: 64_000,
			pattern: 'speech-applause-cheering-integer-v1',
		}),
	}),
	'beat-this-audio-v1': Object.freeze({
		id: 'beat-this-audio-v1', version: 1,
		parameters: Object.freeze({
			sampleRateHz: 22_050, channels: 1, frameCount: 176_400,
			pattern: '120bpm-downbeat-integer-v1',
		}),
	}),
});

const VIDEO_GENERATOR = Object.freeze({
	id: 'transnetv2-rgb-v1', version: 1,
	parameters: Object.freeze({
		width: 48, height: 27, frameCount: 120, timescale: 90_000,
		pattern: 'two-cuts-one-dissolve-vfr-integer-v1',
	}),
});

export const MILESTONE_7_PARITY_GENERATORS = Object.freeze({
	...AUDIO_GENERATORS,
	[VIDEO_GENERATOR.id]: VIDEO_GENERATOR,
});

export function createMilestone7ParityFixture(value) {
	const generator = validateGenerator(value);
	if (Object.hasOwn(AUDIO_GENERATORS, generator.id)) {
		return audioFixture(generator);
	}
	return videoFixture(generator);
}

function validateGenerator(value) {
	if (!plainRecord(value) || !exactKeys(value, ['id', 'version', 'parameters'])
		|| typeof value.id !== 'string'
		|| !Object.hasOwn(MILESTONE_7_PARITY_GENERATORS, value.id)) {
		throw new TypeError('The Milestone 7 parity-fixture generator is invalid.');
	}
	const expected = MILESTONE_7_PARITY_GENERATORS[value.id];
	if (JSON.stringify(value) !== JSON.stringify(expected)) {
		throw new TypeError('The Milestone 7 parity-fixture generator parameters changed.');
	}
	return expected;
}

function audioFixture(generator) {
	const { sampleRateHz, channels, frameCount } = generator.parameters;
	const byteLength = 44 + frameCount * channels * 4;
	const bytes = Buffer.allocUnsafe(byteLength);
	bytes.write('RIFF', 0, 'ascii');
	bytes.writeUInt32LE(byteLength - 8, 4);
	bytes.write('WAVE', 8, 'ascii');
	bytes.write('fmt ', 12, 'ascii');
	bytes.writeUInt32LE(16, 16);
	bytes.writeUInt16LE(3, 20);
	bytes.writeUInt16LE(channels, 22);
	bytes.writeUInt32LE(sampleRateHz, 24);
	bytes.writeUInt32LE(sampleRateHz * channels * 4, 28);
	bytes.writeUInt16LE(channels * 4, 32);
	bytes.writeUInt16LE(32, 34);
	bytes.write('data', 36, 'ascii');
	bytes.writeUInt32LE(frameCount * channels * 4, 40);
	let offset = 44;
	for (let frame = 0; frame < frameCount; frame += 1) {
		for (let channel = 0; channel < channels; channel += 1) {
			bytes.writeFloatLE(audioSample(generator.id, frame, channel), offset);
			offset += 4;
		}
	}
	return bytes;
}

function audioSample(id, frame, channel) {
	if (id === 'tiger-dnr-audio-v1') return tigerSample(frame, channel);
	if (id === 'panns-cnn10-audio-v1') return pannsSample(frame);
	return beatSample(frame);
}

function tigerSample(frame, channel) {
	const dialogue = frame % 257 < 129 ? 0.24 : -0.24;
	const music = ((frame * (channel === 0 ? 17 : 19)) % 2048 - 1024) / 8192;
	const effectPhase = frame % 11_025;
	const effect = effectPhase < 192 ? (192 - effectPhase) / 320 : 0;
	return clampFloat(dialogue + music + (channel === 0 ? effect : -effect * 0.75));
}

function pannsSample(frame) {
	const speechLike = frame % 401 < 200 ? 0.21 : -0.18;
	const applausePhase = frame % 1_280;
	const applause = applausePhase < 48 ? pseudoNoise(frame, 73) * 0.62 : 0;
	const cheer = frame >= 32_000 ? pseudoNoise(frame, 191) * 0.16 : 0;
	return clampFloat(speechLike + applause + cheer);
}

function beatSample(frame) {
	const beatPhase = frame % 11_025;
	const beat = beatPhase < 220 ? (220 - beatPhase) / 244 : 0;
	const downbeatPhase = frame % 44_100;
	const downbeat = downbeatPhase < 330 ? (330 - downbeatPhase) / 660 : 0;
	const bed = ((frame * 29) % 1024 - 512) / 16_384;
	return clampFloat(beat + downbeat + bed);
}

function pseudoNoise(frame, salt) {
	let value = (Math.imul(frame + 1, 1_103_515_245) + salt) >>> 0;
	value ^= value >>> 16;
	return ((value & 65_535) - 32_768) / 32_768;
}

function clampFloat(value) {
	return Math.fround(Math.max(-1, Math.min(1, value)));
}

function videoFixture(generator) {
	const { width, height, frameCount, timescale } = generator.parameters;
	const presentationTicks = [];
	let tick = 0;
	for (let frame = 0; frame < frameCount; frame += 1) {
		presentationTicks.push(String(tick));
		tick += [3_000, 3_003, 2_997, 3_006, 2_994][frame % 5];
	}
	const header = Buffer.from(`soundscaper-m7-parity-rgb24-v1\n${JSON.stringify({
		width, height, frameCount, timescale, presentationTicks,
	})}\n`, 'utf8');
	const pixels = Buffer.allocUnsafe(width * height * frameCount * 3);
	let offset = 0;
	for (let frame = 0; frame < frameCount; frame += 1) {
		for (let y = 0; y < height; y += 1) {
			for (let x = 0; x < width; x += 1) {
				const [red, green, blue] = pixel(frame, x, y);
				pixels[offset] = red;
				pixels[offset + 1] = green;
				pixels[offset + 2] = blue;
				offset += 3;
			}
		}
	}
	return Buffer.concat([header, pixels]);
}

function pixel(frame, x, y) {
	if (frame < 40) return [(x * 3 + frame) & 255, (y * 5) & 255, 24];
	if (frame < 75) return [16, (x + y + frame) & 255, (x * 5 + frame * 2) & 255];
	if (frame < 85) {
		const step = frame - 75;
		return [16 + step * 21, 180 - step * 13, 48 + step * 19].map(clampByte);
	}
	return [(240 - y * 4) & 255, (x * 2 + frame) & 255, (220 - x * 3) & 255];
}

function clampByte(value) {
	return Math.max(0, Math.min(255, value));
}

function plainRecord(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		&& Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value, expected) {
	return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

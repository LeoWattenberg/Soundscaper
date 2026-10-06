/*
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * Frozen measurement baselines from Soundscaper revision 25d7cbdb4. Dynamics
 * adapts Audacity 3.7.7 / SimpleCompressor under GPL version 3; upstream
 * contributors include Matthieu Hodgkinson, Daniel Rudrich, Dominic Mazzoni,
 * Martyn Shaw, Steve Jolly, and Max Maisel. This measurement copy preserves
 * the original arithmetic and imports the unchanged lookahead adaptation.
 */
import {
	applyAudacityLookaheadEnvelopeInPlace,
	audacityDynamicsLookaheadFrames,
} from '../../src/common/editor/audacity-effects/audacity-dynamics-lookahead.ts';

export function baselinePink(options) {
	const sampleRate = options.sampleRate ?? 48_000;
	const frames = Math.round(options.durationSeconds * sampleRate);
	const amplitude = options.amplitude ?? 0.8;
	let state = (Number(options.seed ?? 0x6d2b79f5) >>> 0) || 1;
	return Array.from({ length: options.channelCount }, () => {
		const output = new Float32Array(frames);
		const bins = new Float64Array(7);
		let counter = 0;
		for (let frame = 0; frame < frames; frame += 1) {
			state ^= state << 13;
			state ^= state >>> 17;
			state ^= state << 5;
			const white = (state >>> 0) / 0x8000_0000 - 1;
			counter += 1;
			let zeroes = 0;
			let value = counter;
			while ((value & 1) === 0 && zeroes < bins.length) { zeroes += 1; value >>= 1; }
			if (zeroes < bins.length) bins[zeroes] = white;
			output[frame] = Math.max(-1, Math.min(1, (bins.reduce((sum, bin) => sum + bin, 0) + white) / 4)) * amplitude;
		}
		return output;
	});
}

export function baselineGain(channel, gain) {
	return Float32Array.from(channel, (sample) => sample * gain);
}

export function baselineTone(options) {
	const sampleRate = options.sampleRate ?? 48_000;
	const output = new Float32Array(Math.round(options.durationSeconds * sampleRate));
	const amplitude = options.amplitude ?? 0.8;
	const waveform = options.waveform ?? 'sine';
	const step = (options.frequency ?? 440) / sampleRate;
	let phase = 0;
	for (let frame = 0; frame < output.length; frame += 1) {
		output[frame] = amplitude * baselineOscillator(phase, waveform);
		phase = (phase + step) % 1;
	}
	return Array.from({ length: options.channelCount }, () => new Float32Array(output));
}

function baselineOscillator(phase, waveform) {
	if (waveform === 'square') return phase < 0.5 ? 1 : -1;
	if (waveform === 'sawtooth') return phase * 2 - 1;
	return Math.sin(phase * Math.PI * 2);
}

export function baselineLinkedDynamics(channels, sampleRate, settings) {
	const frames = channels[0].length;
	const envelope = new Float64Array(frames);
	const slope = Number.isFinite(settings.ratio) ? 1 / settings.ratio - 1 : -1;
	const kneeHalf = settings.kneeWidthDb / 2;
	const attackSeconds = settings.attackMs / 1_000;
	const releaseSeconds = settings.releaseMs / 1_000;
	const alphaAttack = attackSeconds === 0 ? 1 : 1 - Math.exp(-1 / (sampleRate * attackSeconds));
	const alphaRelease = releaseSeconds === 0 ? 1 : 1 - Math.exp(-1 / (sampleRate * releaseSeconds));
	let state = 0;
	for (let frame = 0; frame < frames; frame += 1) {
		let sidechain = 0;
		for (const channel of channels) sidechain = Math.max(sidechain, Math.abs(channel[frame]));
		const levelDb = sidechain === 0 ? Number.NEGATIVE_INFINITY : 20 * Math.log10(sidechain);
		const overshoot = levelDb - settings.thresholdDb;
		let reduction;
		if (overshoot <= -kneeHalf) reduction = 0;
		else if (overshoot <= kneeHalf && settings.kneeWidthDb > 0) {
			reduction = 0.5 * slope * (overshoot + kneeHalf) ** 2 / settings.kneeWidthDb;
		} else reduction = slope * overshoot;
		const difference = reduction - state;
		state += (difference < 0 ? alphaAttack : alphaRelease) * difference;
		envelope[frame] = state;
	}
	const lookahead = audacityDynamicsLookaheadFrames(settings.lookaheadMs, sampleRate);
	if (lookahead > 0) applyAudacityLookaheadEnvelopeInPlace(envelope, lookahead, envelope.length);
	return channels.map((channel) => {
		const output = new Float32Array(frames);
		for (let frame = 0; frame < frames; frame += 1) output[frame] = channel[frame] * 10 ** ((envelope[frame] + settings.makeupGainDb) / 20);
		return output;
	});
}

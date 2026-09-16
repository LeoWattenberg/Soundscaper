/* SPDX-License-Identifier: GPL-3.0-only */

export interface ReverbParams {
	roomSize: number;
	preDelay: number;
	reverberance: number;
	damping: number;
	toneLow: number;
	toneHigh: number;
	wetGainDb: number;
	dryGainDb: number;
	stereoWidth: number;
	wetOnly: boolean;
}

export const REVERB_COMB_DELAYS_44K: readonly number[] = Object.freeze([1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617]);
export const REVERB_ALLPASS_DELAYS_44K: readonly number[] = Object.freeze([556, 441, 341, 225]);

export function normalizeReverbParams(params: Partial<ReverbParams> = {}): ReverbParams {
	return {
		roomSize: numberInRange(params.roomSize, 75, 0, 100, 'roomSize'),
		preDelay: numberInRange(params.preDelay, 10, 0, 200, 'preDelay'),
		reverberance: numberInRange(params.reverberance, 50, 0, 100, 'reverberance'),
		damping: numberInRange(params.damping, 50, 0, 100, 'damping'),
		toneLow: numberInRange(params.toneLow, 100, 0, 100, 'toneLow'),
		toneHigh: numberInRange(params.toneHigh, 100, 0, 100, 'toneHigh'),
		wetGainDb: numberInRange(params.wetGainDb, -1, -60, 12, 'wetGainDb'),
		dryGainDb: numberInRange(params.dryGainDb, -1, -60, 12, 'dryGainDb'),
		stereoWidth: numberInRange(params.stereoWidth, 100, 0, 100, 'stereoWidth'),
		wetOnly: normalizeBoolean(params.wetOnly),
	};
}

export function validateReverbSampleRate(sampleRate: number): void {
	if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new RangeError('sampleRate must be positive.');
}

export function reverbCombDelayFrames(index: number, channel: number, sampleRate: number): number {
	const delay = REVERB_COMB_DELAYS_44K[index];
	if (delay === undefined) throw new RangeError('Reverb comb index is outside its delay bank.');
	return Math.max(1, Math.round((delay + channel * 23 + index * channel * 3) * (sampleRate / 44_100)));
}

export function reverbAllpassDelayFrames(index: number, channel: number, sampleRate: number): number {
	const delay = REVERB_ALLPASS_DELAYS_44K[index];
	if (delay === undefined) throw new RangeError('Reverb allpass index is outside its delay bank.');
	return Math.max(1, Math.round((delay + channel * 17 + index * channel * 2) * (sampleRate / 44_100)));
}

// Reverb_libSoX.h puts both wet tone controls around MIDI note 72, spanning
// 48 notes on either side. The low control lowers the high-pass corner.
export function reverbToneCornerHz(percent: number): number {
	return 440 * 2 ** ((72 + percent / 100 * 48 - 69) / 12);
}

/** A conservative settling budget for the browser adaptation, including its wet pre-delay. */
export function audacityBrowserReverbTailFrames(sampleRate: number, params: Partial<ReverbParams> = {}): number {
	validateReverbSampleRate(sampleRate);
	const settings = normalizeReverbParams(params);
	if (settings.reverberance === 0) return 0;
	const feedback = (0.28 + settings.roomSize / 100 * 0.7) * (0.2 + settings.reverberance / 100 * 0.78);
	const damping = Math.min(0.98, settings.damping / 100);
	// AudioWorklet supports up to 32 channels. Cover their longest spread rather
	// than making a capability descriptor depend on a particular channel layout.
	const lastChannel = 31;
	let longestComb = 1;
	let allpassSpan = 0;
	for (let index = 0; index < REVERB_COMB_DELAYS_44K.length; index += 1) {
		longestComb = Math.max(longestComb, reverbCombDelayFrames(index, lastChannel, sampleRate));
	}
	for (let index = 0; index < REVERB_ALLPASS_DELAYS_44K.length; index += 1) {
		allpassSpan += reverbAllpassDelayFrames(index, lastChannel, sampleRate);
	}
	const combDecay = dampedCombDecay(feedback, damping, longestComb);
	const wetGain = 10 ** (settings.wetGainDb / 20) * settings.reverberance / 100;
	// Include downstream absolute-gain headroom for four allpasses and the
	// high-pass, including Float32 delay-line rounding. An isolated impulse can
	// settle earlier than a bounded history that aligns the response's signs.
	const downstreamGainHeadroom = 512;
	const settlingLog = Math.log(1e6 * downstreamGainHeadroom / (1 - feedback)) + Math.max(0, Math.log(wetGain));
	const toneCorner = Math.min(reverbToneCornerHz(-settings.toneLow), reverbToneCornerHz(settings.toneHigh));
	const frames = Math.round(settings.preDelay / 1_000 * sampleRate)
		+ Math.ceil(settlingLog / combDecay)
		+ allpassSpan * Math.ceil(settlingLog / Math.log(2))
		+ Math.ceil(settlingLog * sampleRate / (2 * Math.PI * toneCorner));
	return Math.min(Number.MAX_SAFE_INTEGER, Math.ceil(frames));
}

function dampedCombDecay(feedback: number, damping: number, delay: number): number {
	const feedbackLog = Math.log(feedback);
	if (damping === 0) return -feedbackLog / delay;
	// Solve the positive exponential envelope of the damped feedback loop:
	// feedback * exp(decay * delay) * (1-damping)/(1-damping*exp(decay)) = 1.
	// Keeping the lower bracket makes the estimate conservative, while avoiding
	// a much longer tail from assigning separate worst cases to the two poles.
	let lower = 0;
	let upper = Math.min(-feedbackLog / delay, -Math.log(damping));
	for (let iteration = 0; iteration < 48; iteration += 1) {
		const middle = (lower + upper) / 2;
		const envelope = feedbackLog + middle * delay + Math.log1p(-damping)
			- Math.log1p(-damping * Math.exp(middle));
		if (envelope > 0) upper = middle;
		else lower = middle;
	}
	return lower;
}

function numberInRange(value: unknown, fallback: number, minimum: number, maximum: number, name: string): number {
	const number = Number(value ?? fallback);
	if (!Number.isFinite(number) || number < minimum || number > maximum) throw new RangeError(`${name} must be between ${minimum} and ${maximum}.`);
	return number;
}

function normalizeBoolean(value: unknown): boolean {
	if (typeof value === 'string') return value === 'true' || value === '1' || value === 'on';
	return Boolean(value);
}

/*
 * Shared dither noise generation and deterministic pseudo-random sources.
 *
 * PCM encoders and the bitcrusher effect all reduce a float sample to a
 * coarser level grid, and all of them need the same noise shapes to keep the
 * quantization error uncorrelated with the signal. The noise is expressed in
 * LSB units of whatever grid the caller is quantizing onto, so a 16-bit WAV
 * writer and a 4-bit effect share one implementation.
 *
 * Dither must be added to the signal *before* the quantizer, never to its
 * output: adding it afterwards merely layers noise on top of the distortion
 * instead of linearizing it.
 *
 * Amplitudes, in LSB:
 *   rectangular          1 peak-to-peak, error mean made signal-independent
 *   triangular           2 peak-to-peak, error mean and variance both made
 *                        signal-independent, which is what removes the audible
 *                        noise modulation rectangular dither leaves behind
 *   triangular-highpass  same total power as triangular, redistributed away
 *                        from DC so it sits where hearing is least sensitive
 *
 * Triangular noise is the sum of two independent rectangular draws. Scaling a
 * single rectangular draw to the same width gives the wrong distribution and
 * does not suppress noise modulation.
 */

/** Dither modes offered by the PCM encoders. */
export const PCM_ENCODER_DITHER_MODES = Object.freeze([
	'none',
	'triangular',
	'triangular-highpass',
]);

/** Resolve an encoder dither option, defaulting to triangular. */
export function normalizePcmEncoderDither(value) {
	if (value === false || value === 'none') return 'none';
	if (value === 'triangular-highpass') return value;
	return 'triangular';
}

/**
 * One dither sample in LSB units.
 *
 * `state` carries the previous triangular draw per channel so the high-pass
 * variant can difference against it; pass a Float64Array sized to the channel
 * count and reuse it across the whole stream.
 */
export function pcmDitherNoise(mode, random, channel, state) {
	if (mode === 'none') return 0;
	if (mode === 'rectangular') return random() - 0.5;
	return ditherFromUniforms(mode, random(), random(), channel, state);
}

/**
 * The same noise from two uniforms the caller has already drawn.
 *
 * A real-time processor has to advance its generator the same number of times
 * per sample whatever mode is selected, or the noise stream desynchronizes
 * from the sample index the moment a parameter changes and a render stops
 * matching playback. Such callers draw unconditionally and come here.
 */
export function ditherFromUniforms(mode, first, second, channel, state) {
	if (mode === 'none') return 0;
	if (mode === 'rectangular') return first - 0.5;
	const current = first - second;
	if (mode !== 'triangular-highpass') return current;
	const noise = (current - state[channel]) * 0.5;
	state[channel] = current;
	return noise;
}

/**
 * Deterministic uniform source over [0, 1).
 *
 * `Math.random` cannot be seeded and its state differs between an AudioWorklet
 * global scope and the main thread, so anything that must render identically
 * in real time and offline has to carry its own generator. State is held in a
 * Uint32Array and advanced with Math.imul so every engine agrees bit for bit.
 */
export function createSeededRandom(seed) {
	const state = new Uint32Array(1);
	state[0] = seed >>> 0;
	return () => {
		state[0] = (state[0] + 0x6d2b79f5) >>> 0;
		let t = state[0];
		t = Math.imul(t ^ (t >>> 15), 1 | t);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
	};
}

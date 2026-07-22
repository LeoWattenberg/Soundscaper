/*
 * Shared complex PFFFT WebAssembly runtime for spectral editing and effects.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import createPffftModule from '@echogarden/pffft-wasm/simd';

const PFFFT_FORWARD = 0;
const PFFFT_BACKWARD = 1;
const PFFFT_COMPLEX = 1;
const FLOAT_BYTES = Float32Array.BYTES_PER_ELEMENT;

let module = null;
let initializationError = null;
let ready = null;
const plans = new Map();

export function initializePffft() {
	if (!ready) {
		ready = createPffftModule()
			.then((value) => {
				module = value;
				return value;
			})
			.catch((error) => {
				initializationError = error;
				throw error;
			});
	}
	return ready;
}

export function isPffftReady() {
	return Boolean(module);
}

/**
 * Mutate matching real/imaginary arrays with an ordered complex FFT.
 * PFFFT calculates in float32; inverse transforms are normalized to preserve
 * the contract of the former JavaScript implementations.
 */
export function fft(real, imaginary, inverse = false) {
	if (!module) {
		if (initializationError) throw initializationError;
		throw new Error('PFFFT is not initialized. Await initializePffft() before applying FFT-based effects.');
	}
	const size = validateTransformArrays(real, imaginary);
	const plan = transformPlan(size);
	const interleaved = new Float32Array(module.HEAPF32.buffer, plan.input, size * 2);
	for (let index = 0; index < size; index += 1) {
		interleaved[index * 2] = real[index];
		interleaved[index * 2 + 1] = imaginary[index];
	}
	module._pffft_transform_ordered(
		plan.setup,
		plan.input,
		plan.output,
		plan.work,
		inverse ? PFFFT_BACKWARD : PFFFT_FORWARD,
	);
	const output = new Float32Array(module.HEAPF32.buffer, plan.output, size * 2);
	const scale = inverse ? 1 / size : 1;
	for (let index = 0; index < size; index += 1) {
		real[index] = output[index * 2] * scale;
		imaginary[index] = output[index * 2 + 1] * scale;
	}
}

export function pffftSimdSize() {
	return module?._pffft_simd_size() || 0;
}

function transformPlan(size) {
	const existing = plans.get(size);
	if (existing) return existing;
	const setup = module._pffft_new_setup(size, PFFFT_COMPLEX);
	if (!setup) throw new RangeError(`PFFFT does not support a complex transform of size ${size}.`);
	const bytes = size * 2 * FLOAT_BYTES;
	const input = module._pffft_aligned_malloc(bytes);
	const output = module._pffft_aligned_malloc(bytes);
	const work = module._pffft_aligned_malloc(bytes);
	if (!input || !output || !work) {
		if (input) module._pffft_aligned_free(input);
		if (output) module._pffft_aligned_free(output);
		if (work) module._pffft_aligned_free(work);
		module._pffft_destroy_setup(setup);
		throw new RangeError(`PFFFT could not allocate a transform plan of size ${size}.`);
	}
	const plan = { setup, input, output, work };
	plans.set(size, plan);
	return plan;
}

function validateTransformArrays(real, imaginary) {
	if (!real || !imaginary || typeof real.length !== 'number' || imaginary.length !== real.length) {
		throw new RangeError('FFT arrays must have the same length.');
	}
	const size = real.length;
	if (!Number.isSafeInteger(size) || size < 32 || (size & (size - 1)) !== 0) {
		throw new RangeError('PFFFT arrays must have a power-of-two length of at least 32.');
	}
	return size;
}

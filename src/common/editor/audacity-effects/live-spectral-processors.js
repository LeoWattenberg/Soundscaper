/*
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * The live Audacity inserts that work on spectra or on overlapping windows:
 * click removal, the partitioned-convolution equalizers, and the noise gate.
 * Each buffers a whole analysis window before it can emit, which is the latency
 * its capability declares. Split out of live.js; no behaviour changes here.
 */

import {
	applyAudacityFilterCurveEq,
	applyAudacityGraphicEq,
	applyAudacityNoiseReduction,
} from './spectral.js';
import { fft } from '../pffft.js';
import {
	CLICK_WINDOW_SIZE,
	EQ_PARTITION_SIZE,
	NOISE_CHUNK_SIZE,
	NOISE_HOP_SIZE,
	NOISE_WINDOW_SIZE,
} from './live-capabilities.js';
import {
	LiveProcessor,
	SampleQueue,
	channelAt,
	copyBlock,
	ensureArrayLength,
	validateBlock,
} from './live-processor-base.js';

const CLICK_HOP_SIZE = 4_096;

export class ClickRemovalLiveProcessor extends LiveProcessor {
	constructor(sampleRate, params) { super('audacity-click-removal', sampleRate, params); this.reset(); }
	reset() {
		this.overlap = null;
		this.incoming = [];
		this.outputQueues = [];
		this.separation = 2_049;
	}
	process(input, output) {
		const frames = validateBlock(input, output);
		if (this.params.threshold === 0 || this.params.maximumWidth === 0) {
			copyBlock(input, output, frames);
			return true;
		}
		if (this.incoming.length !== output.length) {
			this.overlap = null;
			this.incoming = Array.from({ length: output.length }, () => []);
			this.outputQueues = Array.from({ length: output.length }, () => new SampleQueue());
			this.separation = 2_049;
		}
		for (let frame = 0; frame < frames; frame += 1) {
			for (let channel = 0; channel < output.length; channel += 1) this.incoming[channel].push(channelAt(input, channel)?.[frame] || 0);
			const needed = this.overlap ? CLICK_HOP_SIZE : CLICK_WINDOW_SIZE;
			if (this.incoming[0].length === needed) this.#processWindow();
			for (let channel = 0; channel < output.length; channel += 1) output[channel][frame] = this.outputQueues[channel].shift(0);
		}
		return true;
	}
	#processWindow() {
		const nextOverlap = [];
		for (let channel = 0; channel < this.incoming.length; channel += 1) {
			const window = new Float32Array(CLICK_WINDOW_SIZE);
			if (this.overlap) window.set(this.overlap[channel]);
			window.set(this.incoming[channel], this.overlap ? CLICK_HOP_SIZE : 0);
			this.separation = removeClicksFromWindow(window, this.params.threshold, this.params.maximumWidth, this.separation);
			this.outputQueues[channel].push(window.subarray(0, CLICK_HOP_SIZE));
			nextOverlap.push(window.slice(CLICK_HOP_SIZE));
			this.incoming[channel] = [];
		}
		this.overlap = nextOverlap;
	}
}

export class EqualizerLiveProcessor extends LiveProcessor {
	constructor(type, sampleRate, params) { super(type, sampleRate, params); this.configure(); this.reset(); }
	configure() {
		this.kernel = buildLiveEqualizerKernel(this.type, this.sampleRate, this.params);
		this.centerDelay = (this.kernel.length - 1) / 2;
		this.kernelPartitions = partitionKernel(this.kernel, EQ_PARTITION_SIZE);
	}
	reset() { this.states = []; }
	process(input, output) {
		const frames = validateBlock(input, output);
		ensureArrayLength(this.states, output.length, () => createPartitionState(this.kernelPartitions.length, EQ_PARTITION_SIZE, this.centerDelay));
		for (let frame = 0; frame < frames; frame += 1) {
			for (let channel = 0; channel < output.length; channel += 1) {
				const state = this.states[channel];
				state.input[state.inputFill++] = channelAt(input, channel)?.[frame] || 0;
				if (state.inputFill === EQ_PARTITION_SIZE) processConvolutionPartition(state, this.kernelPartitions, EQ_PARTITION_SIZE);
				output[channel][frame] = state.started ? state.queue.shift(0) : 0;
			}
		}
		return true;
	}
}

function buildLiveEqualizerKernel(type, sampleRate, params) {
	const length = params.filterLength;
	const impulse = new Float32Array(length);
	impulse[(length - 1) / 2] = 1;
	return type === 'audacity-filter-curve-eq'
		? applyAudacityFilterCurveEq([impulse], sampleRate, params)[0]
		: applyAudacityGraphicEq([impulse], sampleRate, params)[0];
}

function partitionKernel(kernel, partitionSize) {
	const fftSize = partitionSize * 2;
	const count = Math.ceil(kernel.length / partitionSize);
	return Array.from({ length: count }, (_, partition) => {
		const real = new Float64Array(fftSize);
		const imaginary = new Float64Array(fftSize);
		real.set(kernel.subarray(partition * partitionSize, (partition + 1) * partitionSize));
		fft(real, imaginary, false);
		return { real, imaginary };
	});
}

function createPartitionState(partitionCount, partitionSize, discard) {
	const fftSize = partitionSize * 2;
	return {
		input: new Float64Array(partitionSize),
		inputFill: 0,
		overlap: new Float64Array(partitionSize),
		historyReal: Array.from({ length: partitionCount }, () => new Float64Array(fftSize)),
		historyImaginary: Array.from({ length: partitionCount }, () => new Float64Array(fftSize)),
		historyIndex: -1,
		discard,
		queue: new SampleQueue(),
		started: false,
	};
}

function processConvolutionPartition(state, kernelPartitions, partitionSize) {
	const fftSize = partitionSize * 2;
	const inputReal = new Float64Array(fftSize);
	const inputImaginary = new Float64Array(fftSize);
	inputReal.set(state.input);
	fft(inputReal, inputImaginary, false);
	state.historyIndex = (state.historyIndex + 1) % kernelPartitions.length;
	state.historyReal[state.historyIndex].set(inputReal);
	state.historyImaginary[state.historyIndex].set(inputImaginary);
	const outputReal = new Float64Array(fftSize);
	const outputImaginary = new Float64Array(fftSize);
	for (let partition = 0; partition < kernelPartitions.length; partition += 1) {
		const historyIndex = (state.historyIndex - partition + kernelPartitions.length) % kernelPartitions.length;
		const xr = state.historyReal[historyIndex];
		const xi = state.historyImaginary[historyIndex];
		const hr = kernelPartitions[partition].real;
		const hi = kernelPartitions[partition].imaginary;
		for (let bin = 0; bin < fftSize; bin += 1) {
			outputReal[bin] += xr[bin] * hr[bin] - xi[bin] * hi[bin];
			outputImaginary[bin] += xr[bin] * hi[bin] + xi[bin] * hr[bin];
		}
	}
	fft(outputReal, outputImaginary, true);
	const causal = new Float32Array(partitionSize);
	for (let frame = 0; frame < partitionSize; frame += 1) {
		causal[frame] = outputReal[frame] + state.overlap[frame];
		state.overlap[frame] = outputReal[frame + partitionSize];
	}
	let start = 0;
	if (state.discard > 0) {
		start = Math.min(partitionSize, state.discard);
		state.discard -= start;
	}
	if (start < causal.length) state.queue.push(causal.subarray(start));
	if (!state.started && state.discard === 0 && state.queue.length >= partitionSize) state.started = true;
	state.input.fill(0);
	state.inputFill = 0;
}

export class NoiseReductionLiveProcessor extends LiveProcessor {
	constructor(sampleRate, params, profile) {
		super('audacity-noise-reduction', sampleRate, params);
		this.configure();
		this.setNoiseProfile(profile);
	}
	configure() {
		const attackBlocks = 1 + Math.floor(0.02 * this.sampleRate / NOISE_HOP_SIZE);
		const releaseBlocks = 1 + Math.floor(0.1 * this.sampleRate / NOISE_HOP_SIZE);
		this.leftContext = NOISE_WINDOW_SIZE + (2 + releaseBlocks) * NOISE_HOP_SIZE;
		this.rightContext = NOISE_WINDOW_SIZE + (2 + attackBlocks) * NOISE_HOP_SIZE;
	}
	setNoiseProfile(profile) {
		const serializedPowers = profile?.meanPowers;
		const meanPowers = serializedPowers instanceof Float32Array
			? new Float32Array(serializedPowers)
			: Array.isArray(serializedPowers) ? Float32Array.from(serializedPowers) : null;
		if (!profile || profile.type !== 'audacity-noise-profile' || profile.version !== 1 || !meanPowers) {
			throw new TypeError('Live Noise Reduction requires a captured Audacity noise profile.');
		}
		if (profile.sampleRate !== this.sampleRate || profile.windowSize !== NOISE_WINDOW_SIZE || profile.stepsPerWindow !== 4 || meanPowers.length !== NOISE_WINDOW_SIZE / 2 + 1) {
			throw new RangeError('The live Noise Reduction profile uses incompatible analysis settings.');
		}
		for (const power of meanPowers) if (!Number.isFinite(power) || power < 0) throw new RangeError('The live Noise Reduction profile spectrum is invalid.');
		this.profile = {
			...profile,
			meanPowers,
		};
		this.reset();
	}
	reset() {
		this.data = [];
		this.outputQueues = [];
		this.baseFrame = 0;
		this.totalFrames = 0;
		this.nextChunkStart = 0;
	}
	process(input, output) {
		const frames = validateBlock(input, output);
		if (this.data.length !== output.length) {
			this.data = Array.from({ length: output.length }, () => []);
			this.outputQueues = Array.from({ length: output.length }, () => new SampleQueue());
			this.baseFrame = 0;
			this.totalFrames = 0;
			this.nextChunkStart = 0;
		}
		for (let frame = 0; frame < frames; frame += 1) {
			for (let channel = 0; channel < output.length; channel += 1) this.data[channel].push(channelAt(input, channel)?.[frame] || 0);
			this.totalFrames += 1;
			if (this.totalFrames >= this.nextChunkStart + NOISE_CHUNK_SIZE + this.rightContext) this.#renderChunk();
			for (let channel = 0; channel < output.length; channel += 1) output[channel][frame] = this.outputQueues[channel].shift(0);
		}
		return true;
	}
	#renderChunk() {
		const contextStart = this.nextChunkStart - this.leftContext;
		const contextLength = this.leftContext + NOISE_CHUNK_SIZE + this.rightContext;
		const channels = this.data.map((values) => {
			const channel = new Float32Array(contextLength);
			for (let frame = 0; frame < contextLength; frame += 1) {
				const sourceFrame = contextStart + frame;
				const index = sourceFrame - this.baseFrame;
				if (index >= 0 && index < values.length) channel[frame] = values[index];
			}
			return channel;
		});
		const reduced = applyAudacityNoiseReduction(channels, this.sampleRate, this.params, this.profile);
		for (let channel = 0; channel < reduced.length; channel += 1) {
			this.outputQueues[channel].push(reduced[channel].subarray(this.leftContext, this.leftContext + NOISE_CHUNK_SIZE));
		}
		this.nextChunkStart += NOISE_CHUNK_SIZE;
		const dropBefore = Math.max(0, this.nextChunkStart - this.leftContext);
		const drop = dropBefore - this.baseFrame;
		if (drop > 0) {
			for (let channel = 0; channel < this.data.length; channel += 1) this.data[channel].splice(0, drop);
			this.baseFrame = dropBefore;
		}
	}
}

function removeClicksFromWindow(buffer, threshold, maximumWidth, initialSeparation) {
	const length = buffer.length;
	const centerOffset = Math.floor(initialSeparation / 2);
	let separation = 1;
	while (separation < initialSeparation) separation *= 2;
	const squares = new Float64Array(length);
	const meanSquares = new Float64Array(length - separation);
	const prefix = new Float64Array(length + 1);
	for (let index = 0; index < length; index += 1) {
		const square = buffer[index] * buffer[index];
		squares[index] = square;
		prefix[index + 1] = prefix[index] + square;
	}
	for (let index = 0; index < meanSquares.length; index += 1) meanSquares[index] = (prefix[index + separation] - prefix[index]) / separation;
	let left = 0;
	for (let reciprocal = Math.floor(maximumWidth / 4); reciprocal >= 1; reciprocal = Math.floor(reciprocal / 2)) {
		const width = Math.floor(maximumWidth / reciprocal);
		for (let index = 0; index < meanSquares.length; index += 1) {
			let local = 0;
			for (let offset = 0; offset < width; offset += 1) local += squares[index + centerOffset + offset];
			local /= width;
			if (local >= threshold * meanSquares[index] / 10) {
				if (left === 0) left = index + centerOffset;
				continue;
			}
			const right = index + width + centerOffset;
			if (left !== 0 && index - left + centerOffset <= width * 2) {
				const leftValue = buffer[left];
				const rightValue = buffer[right];
				const span = right - left;
				for (let frame = left; frame < right; frame += 1) {
					buffer[frame] = (rightValue * (frame - left) + leftValue * (right - frame)) / span;
					squares[frame] = buffer[frame] * buffer[frame];
				}
				left = 0;
			} else if (left !== 0) left = 0;
		}
	}
	return separation;
}

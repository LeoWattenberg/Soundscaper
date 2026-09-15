/*
 * Narrow loader and streaming driver for the scalar StaffPad WebAssembly ABI.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
	evaluateStaffPadTransform,
	isStaffPadPassThrough,
	normalizeStaffPadRenderRequest,
} from './parameters.js';

import { StaffPadWasmRuntime, instantiateStaffPadWasm } from './wasm-instance.ts';
export { STAFFPAD_REQUIRED_EXPORTS, StaffPadWasmRuntime, instantiateStaffPadWasm } from './wasm-instance.ts';

export const STAFFPAD_WASM_URL = new URL('./staffpad.wasm', import.meta.url);

/** @param {WebAssembly.Module | ArrayBuffer | ArrayBufferView | Response | URL | string} source */
export async function loadStaffPadWasm(source = STAFFPAD_WASM_URL) {
	const module = await compileModule(source);
	return instantiateStaffPadWasm(module);
}

/** @param {WebAssembly.Module | ArrayBuffer | ArrayBufferView | Response | URL | string} source */
export async function loadStaffPadWasmModule(source = STAFFPAD_WASM_URL) {
	return compileModule(source);
}

/**
 * Render one selection while feeding optional raw context before and after it.
 * `onChunk` receives transferable planar Float32Array chunks for the visible
 * selection only; no full output allocation is made in the worker runtime.
 */
export async function renderStaffPad(request, runtime, hooks = {}) {
	const normalized = normalizeStaffPadRenderRequest(request);
	if (!(runtime instanceof StaffPadWasmRuntime) && !isRuntimeLike(runtime)) {
		throw new TypeError('A StaffPadWasmRuntime is required.');
	}
	const isCancelled = hooks.isCancelled || (() => false);
	const onProgress = hooks.onProgress || (() => {});
	const onChunk = hooks.onChunk || (() => {});
	if (isStaffPadPassThrough(normalized.transform)) {
		await renderPassThrough(normalized, { isCancelled, onProgress, onChunk });
		return renderMetadata(normalized, true);
	}

	const firstParameters = evaluateStaffPadTransform(normalized.transform, 0);
	const firstTempo = normalized.transform.keyframes[0].tempoRatio;
	const leadingOutputFrames = Math.max(0, Math.round(normalized.selection.startFrame / firstTempo));
	const targetRenderFrames = leadingOutputFrames + normalized.outputFrames;
	const session = runtime.createSession(
		normalized.sampleRate,
		normalized.channels.length,
		normalized.transform.preserveFormants,
	);
	const accumulator = createChunkAccumulator(normalized.channels.length, normalized.chunkFrames, onChunk);
	let sourceOffset = 0;
	let renderCursor = 0;
	let visibleFrames = 0;
	let latencyToDiscard;
	let iterations = 0;
	let fedFrames = 0;
	const maximumFedFrames = normalized.channels[0].length
		+ normalized.sampleRate * 2
		+ targetRenderFrames * 4;

	try {
		session.setParameters(firstParameters.timeRatio, firstParameters.pitchRatio);
		latencyToDiscard = session.latency(firstParameters.timeRatio * firstParameters.pitchRatio);
		onProgress(0);
		while (renderCursor < targetRenderFrames) {
			throwIfCancelled(isCancelled);
			const available = session.availableOutput();
			if (available > 0) {
				const frames = Math.min(available, runtime.maximumBlockSize);
				const output = session.read(frames);
				let outputOffset = 0;
				if (latencyToDiscard > 0) {
					const discarded = Math.min(latencyToDiscard, frames);
					latencyToDiscard -= discarded;
					outputOffset += discarded;
				}
				const retained = frames - outputOffset;
				if (retained > 0) {
					const blockStart = renderCursor;
					const blockEnd = Math.min(targetRenderFrames, renderCursor + retained);
					const visibleStart = Math.max(blockStart, leadingOutputFrames);
					const visibleEnd = Math.min(blockEnd, targetRenderFrames);
					if (visibleEnd > visibleStart) {
						const sourceStart = outputOffset + visibleStart - blockStart;
						const length = visibleEnd - visibleStart;
						await accumulator.append(output, sourceStart, length);
						visibleFrames += length;
					}
					renderCursor = blockEnd;
					onProgress(Math.min(1, renderCursor / targetRenderFrames));
				}
			} else {
				const required = session.requiredInput();
				if (required <= 0) throw new Error('StaffPad entered an unrecoverable state without input or output demand.');
				const frames = Math.min(required, runtime.maximumBlockSize);
				const position = normalized.outputFrames === 0
					? 0
					: (renderCursor - leadingOutputFrames) / normalized.outputFrames;
				const parameters = evaluateStaffPadTransform(normalized.transform, position);
				session.setParameters(parameters.timeRatio, parameters.pitchRatio);
				session.feed(normalized.channels, sourceOffset, frames);
				sourceOffset += frames;
				fedFrames += frames;
				if (fedFrames > maximumFedFrames) throw new Error('StaffPad exceeded its bounded end-of-input flush.');
			}
			iterations += 1;
			if (iterations % 64 === 0) await yieldToWorkerEventLoop();
		}
		await accumulator.flush();
		if (visibleFrames !== normalized.outputFrames) {
			throw new Error(`StaffPad produced ${visibleFrames} visible frames; expected ${normalized.outputFrames}.`);
		}
		onProgress(1);
		return renderMetadata(normalized, false);
	} finally {
		session.destroy();
	}
}

async function renderPassThrough(request, hooks) {
	const { channels, selection, outputFrames, chunkFrames } = request;
	if (outputFrames !== selection.frameCount) throw new Error('A pass-through StaffPad render must preserve its frame count.');
	hooks.onProgress(0);
	let written = 0;
	while (written < outputFrames) {
		throwIfCancelled(hooks.isCancelled);
		const frames = Math.min(chunkFrames, outputFrames - written);
		const chunk = channels.map((channel) => new Float32Array(
			channel.subarray(selection.startFrame + written, selection.startFrame + written + frames),
		));
		await hooks.onChunk(chunk, written);
		written += frames;
		hooks.onProgress(written / outputFrames);
		await yieldToWorkerEventLoop();
	}
}

function createChunkAccumulator(channelCount, chunkFrames, onChunk) {
	let channels = Array.from({ length: channelCount }, () => new Float32Array(chunkFrames));
	let length = 0;
	let frameOffset = 0;
	async function emit() {
		if (length === 0) return;
		const emitted = length === chunkFrames
			? channels
			: channels.map((channel) => channel.slice(0, length));
		await onChunk(emitted, frameOffset);
		frameOffset += length;
		channels = Array.from({ length: channelCount }, () => new Float32Array(chunkFrames));
		length = 0;
	}
	return {
		async append(source, sourceOffset, frames) {
			let copied = 0;
			while (copied < frames) {
				const amount = Math.min(frames - copied, chunkFrames - length);
				for (let channel = 0; channel < channelCount; channel += 1) {
					channels[channel].set(source[channel].subarray(sourceOffset + copied, sourceOffset + copied + amount), length);
				}
				length += amount;
				copied += amount;
				if (length === chunkFrames) await emit();
			}
		},
		flush: emit,
	};
}

function renderMetadata(request, passThrough) {
	return {
		sampleRate: request.sampleRate,
		channelCount: request.channels.length,
		frameCount: request.outputFrames,
		durationSeconds: request.outputFrames / request.sampleRate,
		passThrough,
	};
}

async function compileModule(source) {
	if (source instanceof WebAssembly.Module) return source;
	if (source instanceof ArrayBuffer) return WebAssembly.compile(source);
	if (ArrayBuffer.isView(source)) {
		return WebAssembly.compile(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength));
	}
	const response = source instanceof Response ? source : await fetch(source);
	if (!response.ok) throw new Error(`Unable to load StaffPad WASM (${response.status} ${response.statusText}).`);
	return WebAssembly.compile(await response.arrayBuffer());
}

function isRuntimeLike(runtime) {
	return runtime && typeof runtime.createSession === 'function'
		&& Number.isInteger(runtime.maximumBlockSize);
}

function throwIfCancelled(isCancelled) {
	if (!isCancelled()) return;
	const error = new Error('StaffPad render was cancelled.');
	error.name = 'AbortError';
	throw error;
}

function yieldToWorkerEventLoop() {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

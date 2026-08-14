/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	readReleasePinnedReviewedEffectBytes,
	resolveReviewedEffectCatalogEntry,
	type ApprovedReviewedEffectCatalogEntry,
} from './catalog.ts';
import {
	ReviewedEffectError,
	isReviewedEffectErrorCode,
	reviewedEffectError,
} from './errors.ts';
import { verifyReviewedEffectDigest } from './hash.ts';
import {
	REVIEWED_EFFECT_MEMORY_EXPORT,
	REVIEWED_EFFECT_PROCESS_EXPORT,
	REVIEWED_EFFECT_LATENCY_EXPORT,
	REVIEWED_EFFECT_TAIL_EXPORT,
	REVIEWED_EFFECT_VERSION_EXPORT,
	reviewedEffectPackageKey,
	type ReviewedEffectManifest,
} from './manifest.ts';
import { compileReviewedEffectWasm } from './wasm-abi.ts';

const WASM_PAGE_BYTES = 65_536;
const MINIMUM_SAMPLE_RATE = 8_000;
const MAXIMUM_SAMPLE_RATE = 768_000;
const loadedPackages = new WeakSet<object>();
const packageLoads = new Map<string, Promise<LoadedReviewedEffectPackage>>();

interface EffectExports extends WebAssembly.Exports {
	readonly memory: WebAssembly.Memory;
	readonly soundscaper_effect_abi_version: WebAssembly.Global;
	readonly soundscaper_effect_latency_frames: WebAssembly.Global;
	readonly soundscaper_effect_tail_frames: WebAssembly.Global;
	readonly soundscaper_effect_process: (
		inputPointer: number,
		outputPointer: number,
		frameCount: number,
		channelCount: number,
		sampleRate: number,
		parameterPointer: number,
		parameterCount: number,
	) => number;
}

export interface LoadedReviewedEffectPackage {
	readonly key: string;
	readonly manifest: ReviewedEffectManifest;
	readonly sha256: string;
	readonly realtimeApproved: boolean;
	readonly module: WebAssembly.Module;
}

export interface ReviewedEffectProcessRequest {
	readonly sampleRate: number;
	readonly channels: readonly Float32Array[];
	readonly parameters?: Readonly<Record<string, number>>;
}

export interface AdmittedReviewedEffectProcess {
	readonly sampleRate: number;
	readonly channels: readonly Float32Array[];
	readonly frameCount: number;
	readonly inputBytes: number;
	readonly parameterValues: Float32Array;
}

/** Load an exact catalog key. There is deliberately no source, URL, or trust option. */
export function loadReviewedEffectPackage(value: unknown): Promise<LoadedReviewedEffectPackage> {
	const descriptor = resolveReviewedEffectCatalogEntry(value);
	const key = reviewedEffectPackageKey(descriptor.manifest);
	let pending = packageLoads.get(key);
	if (!pending) {
		pending = loadCatalogEntry(descriptor).catch((error: unknown) => {
			packageLoads.delete(key);
			throw error;
		});
		packageLoads.set(key, pending);
	}
	return pending;
}

async function loadCatalogEntry(
	descriptor: ApprovedReviewedEffectCatalogEntry,
): Promise<LoadedReviewedEffectPackage> {
	const reference = { id: descriptor.manifest.id, version: descriptor.manifest.version };
	const bytes = readReleasePinnedReviewedEffectBytes(reference);
	await verifyReviewedEffectDigest(bytes, descriptor.sha256);
	const validated = await compileReviewedEffectWasm(bytes, descriptor.manifest);
	const loaded = Object.freeze({
		key: reviewedEffectPackageKey(descriptor.manifest),
		manifest: descriptor.manifest,
		sha256: descriptor.sha256,
		realtimeApproved: descriptor.realtimeApproved,
		module: validated.module,
	});
	loadedPackages.add(loaded);
	return loaded;
}

export class ReviewedEffectWasmRuntime {
	readonly package: LoadedReviewedEffectPackage;
	readonly instance: WebAssembly.Instance;
	readonly exports: EffectExports;

	constructor(loadedPackage: LoadedReviewedEffectPackage) {
		if (!loadedPackages.has(loadedPackage)) {
			throw reviewedEffectError('PACKAGE_NOT_FOUND', 'Reviewed effect runtime requires a release-catalog package.');
		}
		this.package = loadedPackage;
		try {
			this.instance = new WebAssembly.Instance(loadedPackage.module, {});
		} catch (error) {
			throw reviewedEffectError('ABI_INVALID', 'Reviewed effect WASM could not be instantiated.', error);
		}
		this.exports = this.instance.exports as EffectExports;
		if (!(this.exports[REVIEWED_EFFECT_MEMORY_EXPORT] instanceof WebAssembly.Memory)
			|| !(this.exports[REVIEWED_EFFECT_VERSION_EXPORT] instanceof WebAssembly.Global)
			|| !(this.exports[REVIEWED_EFFECT_LATENCY_EXPORT] instanceof WebAssembly.Global)
			|| !(this.exports[REVIEWED_EFFECT_TAIL_EXPORT] instanceof WebAssembly.Global)
			|| typeof this.exports[REVIEWED_EFFECT_PROCESS_EXPORT] !== 'function') {
			throw reviewedEffectError('ABI_INVALID', 'Reviewed effect runtime exports changed after validation.');
		}
	}

	process(request: ReviewedEffectProcessRequest): readonly Float32Array[] {
		const admitted = admitReviewedEffectProcess(this.package.manifest, request);
		const { memory } = this.exports;
		const outputPointer = admitted.inputBytes;
		const parameterPointer = outputPointer + admitted.inputBytes;
		const requiredBytes = parameterPointer + admitted.parameterValues.byteLength;
		ensureMemoryCapacity(memory, requiredBytes, this.package.manifest.resources.maximumMemoryPages);
		const samples = admitted.frameCount * admitted.channels.length;
		const input = new Float32Array(memory.buffer, 0, samples);
		for (let channel = 0; channel < admitted.channels.length; channel += 1) {
			input.set(admitted.channels[channel]!, channel * admitted.frameCount);
		}
		new Float32Array(
			memory.buffer,
			parameterPointer,
			admitted.parameterValues.length,
		).set(admitted.parameterValues);
		let status: number;
		try {
			status = this.exports.soundscaper_effect_process(
				0,
				outputPointer,
				admitted.frameCount,
				admitted.channels.length,
				admitted.sampleRate,
				parameterPointer,
				admitted.parameterValues.length,
			);
		} catch (error) {
			throw reviewedEffectError('PROCESSING_FAILED', 'Reviewed effect WASM trapped while processing audio.', error);
		}
		if (status !== 0) {
			throw reviewedEffectError('PROCESSING_FAILED', `Reviewed effect WASM returned status ${String(status)}.`);
		}
		if (memory.buffer.byteLength > this.package.manifest.resources.maximumMemoryPages * WASM_PAGE_BYTES) {
			throw reviewedEffectError('WASM_LIMIT', 'Reviewed effect WASM exceeded its memory page limit.');
		}
		const output = new Float32Array(memory.buffer, outputPointer, samples);
		const channels = Array.from({ length: admitted.channels.length }, (_, channel) => {
			const result = output.slice(
				channel * admitted.frameCount,
				(channel + 1) * admitted.frameCount,
			);
			for (const sample of result) {
				if (!Number.isFinite(sample)) {
					throw reviewedEffectError('PROCESSING_FAILED', 'Reviewed effect WASM returned non-finite audio.');
				}
			}
			return result;
		});
		return Object.freeze(channels);
	}
}

export function admitReviewedEffectProcess(
	manifest: ReviewedEffectManifest,
	request: ReviewedEffectProcessRequest,
): AdmittedReviewedEffectProcess {
	const sampleRate = request.sampleRate;
	if (!Number.isSafeInteger(sampleRate) || sampleRate < MINIMUM_SAMPLE_RATE || sampleRate > MAXIMUM_SAMPLE_RATE) {
		throw reviewedEffectError('INPUT_LIMIT', 'Reviewed effect sample rate is outside the supported range.');
	}
	const channels = request.channels;
	if (!Array.isArray(channels) || channels.length < 1
		|| channels.length > manifest.resources.maximumChannels
		|| channels.some((channel) => !(channel instanceof Float32Array))) {
		throw reviewedEffectError('INPUT_LIMIT', 'Reviewed effect input has an invalid channel count or sample type.');
	}
	const frameCount = channels[0]!.length;
	if (frameCount < 1 || frameCount > manifest.resources.maximumBlockFrames
		|| channels.some((channel) => channel.length !== frameCount)) {
		throw reviewedEffectError('INPUT_LIMIT', 'Reviewed effect input exceeds its frame limit or has unequal channels.');
	}
	const inputBytes = channels.length * frameCount * Float32Array.BYTES_PER_ELEMENT;
	if (inputBytes > manifest.resources.maximumInputBytes) {
		throw reviewedEffectError('INPUT_LIMIT', 'Reviewed effect input exceeds its declared byte limit.');
	}
	for (const channel of channels) {
		for (const sample of channel) {
			if (!Number.isFinite(sample)) {
				throw reviewedEffectError('INPUT_LIMIT', 'Reviewed effect input contains non-finite audio.');
			}
		}
	}
	return Object.freeze({
		sampleRate,
		channels,
		frameCount,
		inputBytes,
		parameterValues: normalizeParameterValues(manifest, request.parameters),
	});
}

function normalizeParameterValues(
	manifest: ReviewedEffectManifest,
	value: Readonly<Record<string, number>> | undefined,
): Float32Array {
	const candidate: unknown = value ?? {};
	if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
		throw reviewedEffectError('INPUT_LIMIT', 'Reviewed effect parameters must be a plain object.');
	}
	const prototype = Object.getPrototypeOf(candidate) as unknown;
	if (prototype !== Object.prototype && prototype !== null) {
		throw reviewedEffectError('INPUT_LIMIT', 'Reviewed effect parameters must be a plain object.');
	}
	const known = new Map(manifest.parameters.map((parameter) => [parameter.id, parameter]));
	for (const key of Reflect.ownKeys(candidate)) {
		const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
		if (typeof key !== 'string' || !known.has(key) || !descriptor?.enumerable
			|| !Object.hasOwn(descriptor, 'value')) {
			throw reviewedEffectError('INPUT_LIMIT', `Unknown or invalid reviewed effect parameter: ${String(key)}.`);
		}
	}
	const record = candidate as Readonly<Record<string, unknown>>;
	return Float32Array.from(manifest.parameters.map((parameter) => {
		const parameterValue = record[parameter.id] ?? parameter.defaultValue;
		if (typeof parameterValue !== 'number' || !Number.isFinite(parameterValue)
			|| parameterValue < parameter.minimum || parameterValue > parameter.maximum) {
			throw reviewedEffectError('INPUT_LIMIT', `Reviewed effect parameter ${parameter.id} is outside its range.`);
		}
		return parameterValue;
	}));
}

function ensureMemoryCapacity(memory: WebAssembly.Memory, bytes: number, maximumPages: number): void {
	if (bytes > maximumPages * WASM_PAGE_BYTES) {
		throw reviewedEffectError('WASM_LIMIT', 'Reviewed effect request exceeds the WASM memory envelope.');
	}
	const missingPages = Math.ceil((bytes - memory.buffer.byteLength) / WASM_PAGE_BYTES);
	if (missingPages <= 0) return;
	try {
		memory.grow(missingPages);
	} catch (error) {
		throw reviewedEffectError('WASM_LIMIT', 'Reviewed effect WASM memory cannot contain the request.', error);
	}
}

export function deserializeReviewedEffectError(value: unknown): ReviewedEffectError {
	const candidate = value as Readonly<{ code?: unknown; message?: unknown }> | null;
	if (!isReviewedEffectErrorCode(candidate?.code) || typeof candidate.message !== 'string'
		|| candidate.message.length < 1 || candidate.message.length > 1_024) {
		return reviewedEffectError('WORKER_PROTOCOL', 'Reviewed effect worker returned an invalid error.');
	}
	return reviewedEffectError(candidate.code, candidate.message);
}

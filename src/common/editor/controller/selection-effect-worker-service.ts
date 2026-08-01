/* SPDX-License-Identifier: AGPL-3.0-only */

import { cloneAudacityWorkerPayload } from './nyquist-audio.ts';
import { WorkerRequestCancelledError, WorkerRequestTimeoutError } from '../worker-protocol.ts';
import {
	inspectSpectralEditChannels,
	planSpectralEditJobAdmission,
} from '../spectral-edit-admission.ts';
import type { EditorProjectToken } from './lifecycle.ts';

const DEFAULT_EFFECT_WORKER_TIMEOUT_MS = 120_000;
const INTRINSIC_TYPED_ARRAY_SET = intrinsicTypedArraySet();

export interface EffectWorkerLike {
	onmessage: ((event: Readonly<{ data: unknown }>) => void) | null;
	onerror: ((event: Readonly<{ error?: unknown; message?: string }>) => void) | null;
	onmessageerror: ((event: Readonly<{ data?: unknown }>) => void) | null;
	postMessage(message: unknown, transfer?: readonly Transferable[]): void;
	terminate(): void;
}

export interface EffectWorkerState {
	audacityEffectWorker: EffectWorkerLike | null;
	spectralWorker: EffectWorkerLike | null;
}

export interface SelectionEffectWorkerContext extends Readonly<Record<string, unknown>> {
	readonly controlChannels?: Float32Array[];
	readonly beforeChannels?: Float32Array[];
	readonly afterChannels?: Float32Array[];
}

export interface SelectionEffectWorkerRequest extends Readonly<Record<string, unknown>> {
	readonly operation: 'apply' | 'capture-noise-profile';
	readonly effectType?: string;
	readonly channels: Float32Array[];
	readonly sampleRate: number;
	readonly params: unknown;
	readonly context?: SelectionEffectWorkerContext;
	readonly wasmModule?: unknown;
}

export interface SelectionEffectWorkerResult extends Readonly<Record<string, unknown>> {
	readonly type?: string;
	readonly channels?: Float32Array[];
	readonly profile?: unknown;
}

export interface SpectralEditOptions extends Readonly<Record<string, unknown>> {
	readonly sampleRate: number;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly minimumFrequency: number;
	readonly maximumFrequency: number;
	readonly windowSize: number;
	readonly gainDb: number;
}

interface EffectWorkerCopy {
	readonly effectProcessingFailed: string;
}

export interface SelectionEffectWorkerServiceRuntime {
	readonly state: EffectWorkerState;
	readonly copy: EffectWorkerCopy;
	readonly workerAvailable?: () => boolean;
	readonly createSelectionWorker?: () => EffectWorkerLike;
	readonly createSpectralWorker?: () => EffectWorkerLike;
	readonly captureProject: () => EditorProjectToken;
	readonly assertProject: (token: EditorProjectToken) => void;
	readonly loadParametricEqWasmModule: () => Promise<unknown>;
	readonly initializePffft: () => Promise<unknown>;
	readonly captureNoiseProfile: (
		channels: Float32Array[],
		sampleRate: number,
		params: unknown,
	) => unknown;
	readonly applySelectionEffect: (
		effectType: string,
		channels: Float32Array[],
		sampleRate: number,
		params: unknown,
		context: SelectionEffectWorkerContext & Readonly<{ wasmModule?: unknown }>,
	) => Promise<Float32Array[]>;
	readonly applySpectralGain: (
		channels: Float32Array[],
		options: SpectralEditOptions,
	) => Promise<Float32Array[]> | Float32Array[];
	readonly spectralMaximumUsefulBinaryBytes?: number;
	readonly timeoutMs?: number;
	readonly setTimeout?: (callback: () => void, delay: number) => ReturnType<typeof globalThis.setTimeout>;
	readonly clearTimeout?: (handle: ReturnType<typeof globalThis.setTimeout>) => void;
	readonly onProgress?: (value: number) => void;
}

interface WorkerOwner {
	readonly worker: EffectWorkerLike;
	cancel(error: Error): void;
}

export interface EffectWorkerRunOptions {
	readonly signal?: AbortSignal | null;
	readonly timeoutMs?: number;
	readonly onProgress?: (value: number) => void;
}

export function createSelectionEffectWorkerService(runtime: SelectionEffectWorkerServiceRuntime) {
	let selectionOwner: WorkerOwner | null = null;
	let spectralOwner: WorkerOwner | null = null;
	const scheduleTimeout = runtime.setTimeout ?? ((callback, delay) => globalThis.setTimeout(callback, delay));
	const clearScheduledTimeout = runtime.clearTimeout ?? ((handle) => globalThis.clearTimeout(handle));

	async function runSelectionEffectWorker(
		payload: SelectionEffectWorkerRequest,
		options: EffectWorkerRunOptions = {},
	): Promise<SelectionEffectWorkerResult> {
		const projectToken = runtime.captureProject();
		throwIfAborted(options.signal);
		const request = payload.effectType === 'eq' && !payload.wasmModule
			? { ...payload, wasmModule: await runtime.loadParametricEqWasmModule() }
			: payload;
		runtime.assertProject(projectToken);
		throwIfAborted(options.signal);
		if (!workerIsAvailable(runtime)) {
			if (request.operation === 'capture-noise-profile') {
				await runtime.initializePffft();
				runtime.assertProject(projectToken);
				throwIfAborted(options.signal);
				const profile = runtime.captureNoiseProfile(request.channels, request.sampleRate, request.params);
				runtime.assertProject(projectToken);
				return { profile };
			}
			const channels = await runtime.applySelectionEffect(
				request.effectType || '',
				request.channels,
				request.sampleRate,
				request.params,
				{ ...(request.context || {}), wasmModule: request.wasmModule },
			);
			runtime.assertProject(projectToken);
			throwIfAborted(options.signal);
			return { channels };
		}

		selectionOwner?.cancel(new WorkerRequestCancelledError());
		const worker = (runtime.createSelectionWorker ?? createDefaultSelectionWorker)();
		runtime.state.audacityEffectWorker = worker;
		const transfer: ArrayBuffer[] = [];
		const message = (cloneAudacityWorkerPayload as (
			request: SelectionEffectWorkerRequest,
			transfer: ArrayBuffer[],
		) => unknown)(request, transfer);
		const result = await executeWorker<SelectionEffectWorkerResult>({
			worker,
			message,
			transfer,
			signal: options.signal,
			timeoutMs: normalizeTimeout(options.timeoutMs ?? runtime.timeoutMs),
			processingFailedMessage: runtime.copy.effectProcessingFailed,
			acceptMessage: selectionWorkerMessage,
			setOwner: (owner) => { selectionOwner = owner; },
			clearOwner: (owner) => {
				if (selectionOwner === owner) selectionOwner = null;
				if (runtime.state.audacityEffectWorker === worker) runtime.state.audacityEffectWorker = null;
			},
			onProgress: options.onProgress ?? runtime.onProgress,
			scheduleTimeout,
			clearScheduledTimeout,
		});
		runtime.assertProject(projectToken);
		throwIfAborted(options.signal);
		return result;
	}

	async function runSpectralEditWorker(
		channels: Float32Array[],
		spectralOptions: SpectralEditOptions,
		options: EffectWorkerRunOptions = {},
	): Promise<Float32Array[]> {
		const projectToken = runtime.captureProject();
		throwIfAborted(options.signal);
		const input = inspectSpectralEditChannels(channels, { label: 'Spectral edit input' });
		const admission = planSpectralEditJobAdmission({
			channelCount: input.channelCount,
			frameCount: input.frameCount,
			selectionFrameCount: spectralOptions.endFrame - spectralOptions.startFrame,
			windowSize: spectralOptions.windowSize,
			maximumUsefulBinaryBytes: runtime.spectralMaximumUsefulBinaryBytes,
		});
		const geometry = admission.phases[0]!;
		if (!workerIsAvailable(runtime)) {
			await runtime.initializePffft();
			runtime.assertProject(projectToken);
			throwIfAborted(options.signal);
			const currentInput = inspectSpectralEditChannels(input.channels, {
				label: 'Spectral edit input',
				expectedChannelCount: geometry.channelCount,
				expectedFrameCount: geometry.frameCount,
			});
			const fallbackChannels = cloneSpectralChannels(currentInput.channels, geometry.frameCount);
			const result = await runtime.applySpectralGain(fallbackChannels, spectralOptions);
			runtime.assertProject(projectToken);
			throwIfAborted(options.signal);
			return exactSpectralResultChannels(result, geometry, 'Spectral edit fallback result');
		}

		const timeoutMs = normalizeTimeout(options.timeoutMs ?? runtime.timeoutMs);
		spectralOwner?.cancel(new WorkerRequestCancelledError());
		const workerChannels = cloneSpectralChannels(input.channels, geometry.frameCount);
		const worker = (runtime.createSpectralWorker ?? createDefaultSpectralWorker)();
		runtime.state.spectralWorker = worker;
		const result = await executeWorker<Readonly<{ channels: Float32Array[] }>>({
			worker,
			message: { channels: workerChannels, options: spectralOptions },
			transfer: workerChannels.map((channel) => channel.buffer),
			signal: options.signal,
			timeoutMs,
			processingFailedMessage: runtime.copy.effectProcessingFailed,
			acceptMessage: (data) => spectralWorkerMessage(data, geometry),
			setOwner: (owner) => { spectralOwner = owner; },
			clearOwner: (owner) => {
				if (spectralOwner === owner) spectralOwner = null;
				if (runtime.state.spectralWorker === worker) runtime.state.spectralWorker = null;
			},
			onProgress: options.onProgress ?? runtime.onProgress,
			scheduleTimeout,
			clearScheduledTimeout,
		});
		runtime.assertProject(projectToken);
		throwIfAborted(options.signal);
		return result.channels;
	}

	function cancelWorkers(reason: Error = new WorkerRequestCancelledError()): void {
		selectionOwner?.cancel(reason);
		spectralOwner?.cancel(reason);
	}

	return Object.freeze({ cancelWorkers, runSelectionEffectWorker, runSpectralEditWorker });
}

interface ExecuteWorkerOptions<Result> {
	readonly worker: EffectWorkerLike;
	readonly message: unknown;
	readonly transfer: readonly Transferable[];
	readonly signal?: AbortSignal | null;
	readonly timeoutMs: number;
	readonly processingFailedMessage: string;
	readonly acceptMessage: (data: unknown) => Result | Error | null;
	readonly setOwner: (owner: WorkerOwner) => void;
	readonly clearOwner: (owner: WorkerOwner) => void;
	readonly onProgress?: (value: number) => void;
	readonly scheduleTimeout: (callback: () => void, delay: number) => ReturnType<typeof globalThis.setTimeout>;
	readonly clearScheduledTimeout: (handle: ReturnType<typeof globalThis.setTimeout>) => void;
}

function executeWorker<Result>(options: ExecuteWorkerOptions<Result>): Promise<Result> {
	return new Promise<Result>((resolve, reject) => {
		let settled = false;
		let timer: ReturnType<typeof globalThis.setTimeout> | null = null;
		const onAbort = () => settle(null, abortReason(options.signal));
		const owner: WorkerOwner = {
			worker: options.worker,
			cancel: (error) => settle(null, error),
		};
		function cleanup(): void {
			if (timer != null) options.clearScheduledTimeout(timer);
			timer = null;
			options.signal?.removeEventListener('abort', onAbort);
			options.worker.onmessage = null;
			options.worker.onerror = null;
			options.worker.onmessageerror = null;
			options.worker.terminate();
			options.clearOwner(owner);
		}
		function settle(result: Result | null, error: Error | null): void {
			if (settled) return;
			settled = true;
			cleanup();
			if (error) reject(error);
			else resolve(result as Result);
		}
		options.setOwner(owner);
		options.signal?.addEventListener('abort', onAbort, { once: true });
		options.worker.onmessage = ({ data }) => {
			if (isRecord(data) && data.type === 'progress') {
				const value = Number(data.ratio ?? data.progress);
				if (Number.isFinite(value)) options.onProgress?.(Math.max(0, Math.min(1, value)));
				return;
			}
			let outcome: Result | Error | null;
			try {
				outcome = options.acceptMessage(data);
			} catch (error) {
				settle(null, error instanceof Error ? error : new Error(String(error)));
				return;
			}
			if (outcome instanceof Error) settle(null, outcome);
			else if (outcome !== null) settle(outcome, null);
		};
		options.worker.onerror = ({ error, message }) => settle(
			null,
			error instanceof Error ? error : new Error(message || options.processingFailedMessage),
		);
		options.worker.onmessageerror = () => settle(null, new Error(options.processingFailedMessage));
		timer = options.scheduleTimeout(
			() => settle(null, new WorkerRequestTimeoutError(options.timeoutMs)),
			options.timeoutMs,
		);
		unrefTimer(timer);
		if (options.signal?.aborted) {
			onAbort();
			return;
		}
		try {
			options.worker.postMessage(options.message, options.transfer);
		} catch (error) {
			settle(null, error instanceof Error ? error : new Error(String(error)));
		}
	});
}

function selectionWorkerMessage(data: unknown): SelectionEffectWorkerResult | Error | null {
	if (!isRecord(data)) return null;
	if (data.type === 'error') return workerReportedError(data);
	if (data.type !== 'result' && data.type !== 'noise-profile') return null;
	return data as SelectionEffectWorkerResult;
}

function spectralWorkerMessage(
	data: unknown,
	geometry: Readonly<{ channelCount: number; frameCount: number }>,
): Readonly<{ channels: Float32Array[] }> | Error | null {
	if (!isRecord(data)) return null;
	if (data.type === 'error') return workerReportedError(data);
	if (data.type !== 'result') return null;
	return { channels: exactSpectralResultChannels(data.channels, geometry, 'Spectral edit worker result') };
}

function exactSpectralResultChannels(
	channels: unknown,
	geometry: Readonly<{ channelCount: number; frameCount: number }>,
	label: string,
): Float32Array[] {
	const result = inspectSpectralEditChannels(channels, {
		label,
		expectedChannelCount: geometry.channelCount,
		expectedFrameCount: geometry.frameCount,
	});
	return [...result.channels];
}

function cloneSpectralChannels(
	channels: readonly Float32Array[],
	frameCount: number,
): Float32Array[] {
	const clones = new Array<Float32Array>(channels.length);
	for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
		const clone = new Float32Array(frameCount);
		INTRINSIC_TYPED_ARRAY_SET.call(clone, channels[channelIndex]!);
		clones[channelIndex] = clone;
	}
	return clones;
}

function intrinsicTypedArraySet(): (
	this: Float32Array,
	source: ArrayLike<number>,
	offset?: number,
) => void {
	const prototype = Object.getPrototypeOf(Float32Array.prototype) as object;
	const set = Object.getOwnPropertyDescriptor(prototype, 'set')?.value;
	if (typeof set !== 'function') throw new Error('Typed-array intrinsic methods are unavailable.');
	return set as (this: Float32Array, source: ArrayLike<number>, offset?: number) => void;
}

function workerReportedError(data: Readonly<Record<string, unknown>>): Error {
	const error = new Error(String(data.message || 'Effect processing failed.')) as Error & { code?: string };
	error.name = String(data.name || 'Error');
	if (data.code) error.code = String(data.code);
	return error;
}

function workerIsAvailable(runtime: SelectionEffectWorkerServiceRuntime): boolean {
	return runtime.workerAvailable ? runtime.workerAvailable() : typeof Worker === 'function';
}

function createDefaultSelectionWorker(): EffectWorkerLike {
	return new Worker(new URL('../selection-effects-worker.js', import.meta.url), { type: 'module' }) as unknown as EffectWorkerLike;
}

function createDefaultSpectralWorker(): EffectWorkerLike {
	return new Worker(new URL('../spectral-edit-worker.js', import.meta.url), { type: 'module' }) as unknown as EffectWorkerLike;
}

function normalizeTimeout(value: number | undefined): number {
	const result = value ?? DEFAULT_EFFECT_WORKER_TIMEOUT_MS;
	if (!Number.isSafeInteger(result) || result < 1) throw new RangeError('Effect worker timeout must be positive.');
	return result;
}

function throwIfAborted(signal: AbortSignal | null | undefined): void {
	if (signal?.aborted) throw abortReason(signal);
}

function abortReason(signal: AbortSignal | null | undefined): Error {
	return signal?.reason instanceof Error ? signal.reason : new WorkerRequestCancelledError();
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === 'object' && value !== null;
}

function unrefTimer(timer: ReturnType<typeof globalThis.setTimeout>): void {
	const candidate: unknown = timer;
	if (!candidate || typeof candidate !== 'object' || !('unref' in candidate)) return;
	const unref = (candidate as { readonly unref?: unknown }).unref;
	if (typeof unref === 'function') unref.call(candidate);
}

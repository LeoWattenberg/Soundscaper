/* SPDX-License-Identifier: AGPL-3.0-only */

/** Shared CPU-session, runtime-validation, and single-output ONNX worker mechanics. */

import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

import type {
	AssistanceOnnxInferenceSessionV1,
	AssistanceOnnxRuntimeModuleV1,
} from './assistance-onnx-runtime-worker.ts';
import type {
	AssistanceRuntimeFamilyJobResultV1,
	AssistanceRuntimeFamilyTask,
} from './assistance-runtime-family-job-contract.ts';
import type {
	AssistanceRuntimeFamilyWorkerExecutionContext,
} from './assistance-runtime-family-worker-entry.ts';

export interface AssistanceOnnxSurfaceErrorsV1 {
	readonly value: string;
	readonly surface: string;
}

export interface AssistanceOnnxOutputPublicationOptionsV1 {
	readonly exactOutputCount?: number;
}

export interface AssistanceOnnxSessionLeaseCacheOptionsV1 {
	/** Lower-only bounds; production keeps at most one idle native session. */
	readonly idleTtlMs?: number;
	readonly maximumModelBytes?: number;
	readonly maximumIdleRssBytes?: number;
	readonly getRssBytes?: () => number;
}

interface OnnxSessionEntry {
	readonly key: string;
	readonly modelBytes: number;
	readonly session: AssistanceOnnxInferenceSessionV1;
	readonly runs: Set<Promise<unknown>>;
	leases: number;
}

/** Called only inside the execute port, after fresh job/model file authentication. */
export function createAssistanceOnnxSessionLeaseCacheV1(options: AssistanceOnnxSessionLeaseCacheOptionsV1 = {}) {
	return new AssistanceOnnxSessionLeaseCacheV1(options);
}

export class AssistanceOnnxSessionLeaseCacheV1 {
	readonly #entries = new Map<string, OnnxSessionEntry>();
	readonly #creations = new Map<string, Promise<OnnxSessionEntry>>();
	readonly #ttl: number;
	readonly #modelLimit: number;
	readonly #rssLimit: number;
	readonly #rss: () => number;
	#active: AssistanceRuntimeFamilyWorkerExecutionContext | null = null;
	#scopeKey: string | null = null;
	#timer: ReturnType<typeof setTimeout> | null = null;
	#retirement: Promise<void> = Promise.resolve();
	#closed = false;

	constructor(options: AssistanceOnnxSessionLeaseCacheOptionsV1) {
		this.#ttl = lowerBound(options.idleTtlMs, 30_000, 'ONNX idle TTL');
		this.#modelLimit = lowerBound(options.maximumModelBytes, 512 * 1024 ** 2, 'ONNX idle model bytes');
		this.#rssLimit = lowerBound(options.maximumIdleRssBytes, 1024 ** 3, 'ONNX idle RSS');
		if (options.getRssBytes !== undefined && typeof options.getRssBytes !== 'function') throw new TypeError('ONNX RSS reader is invalid.');
		this.#rss = options.getRssBytes ?? (() => process.memoryUsage().rss);
	}

	get idleSessionCount(): number { return this.#active === null ? this.#entries.size : 0; }

	async runAuthenticated<Value>(context: AssistanceRuntimeFamilyWorkerExecutionContext, operation: () => Promise<Value>): Promise<Value> {
		if (this.#closed) throw new Error('The ONNX session cache is closed.');
		if (this.#active !== null) throw new Error('An ONNX authenticated scope is already active.');
		this.#active = context;
		this.#clearTimer();
		try {
			await this.#retirement;
			context.signal?.throwIfAborted();
			const key = createHash('sha256').update(JSON.stringify([
				context.job.descriptor, context.grant.task, context.grant.settingsJson, context.grant.models,
			])).digest('hex');
			if (this.#scopeKey !== key) await this.#retire();
			this.#scopeKey = key;
			const result = await operation();
			context.signal?.throwIfAborted();
			if (this.#creations.size !== 0 || [...this.#entries.values()].some((entry) => entry.leases !== 0 || entry.runs.size !== 0)) {
				throw new Error('The ONNX job retained active inference leases after completion.');
			}
			const recent = [...this.#entries.values()].at(-1);
			for (const entry of [...this.#entries.values()]) if (entry !== recent) {
				this.#entries.delete(entry.key);
				await releaseOnnxEntry(entry);
			}
			const rss = this.#rss();
			if (!recent || recent.modelBytes > this.#modelLimit || !Number.isSafeInteger(rss) || rss < 0
				|| rss > Math.min(this.#rssLimit, Math.floor(context.job.maximumRssBytes / 2))) await this.#retire();
			this.#active = null;
			if (this.#entries.size) {
				this.#timer = setTimeout(() => {
					this.#timer = null;
					void this.#retire().catch(() => { this.#closed = true; });
				}, this.#ttl);
				this.#timer.unref();
			}
			return result;
		} catch (error) {
			this.#closed = true;
			try { await this.#retire(); }
			catch (cleanup) { throw new AggregateError([error, cleanup], 'ONNX inference and session retirement failed.', { cause: cleanup }); }
			throw error;
		} finally { this.#active = null; }
	}

	wrapRuntime(runtime: AssistanceOnnxRuntimeModuleV1): AssistanceOnnxRuntimeModuleV1 {
		const scope = this.#active;
		if (!scope || !this.#scopeKey) throw new Error('ONNX sessions require an authenticated scope.');
		return { Tensor: runtime.Tensor, InferenceSession: {
			create: async (modelPath, settings) => {
				this.#assertScope(scope);
				const model = scope.grant.models.find((item) => item.path === modelPath);
				if (!model) throw new Error('ONNX session creation requires a freshly authenticated model grant.');
				const key = `${String(this.#scopeKey)}:${modelPath}:${JSON.stringify(settings)}`;
				let entry = this.#entries.get(key);
				if (!entry) {
					let pending = this.#creations.get(key);
					if (!pending) {
						pending = this.#createEntry(runtime, scope, key, modelPath, settings);
						this.#creations.set(key, pending);
					}
					try { entry = await pending; }
					finally { if (this.#creations.get(key) === pending) this.#creations.delete(key); }
				}
				this.#assertScope(scope);
				const owned = entry;
				owned.leases += 1;
				let released = false;
				return {
					inputNames: Object.freeze([...owned.session.inputNames]), outputNames: Object.freeze([...owned.session.outputNames]),
					run: async (feeds) => {
						if (released) throw new Error('The ONNX request lease is released.');
						this.#assertScope(scope);
						const pending = Promise.resolve(owned.session.run(feeds));
						owned.runs.add(pending);
						try { const result = await pending; this.#assertScope(scope); return result; }
						finally { owned.runs.delete(pending); }
					},
					release: () => {
						if (released) return;
						released = true;
						owned.leases -= 1;
					},
				};
			},
		} };
	}

	async #createEntry(
		runtime: AssistanceOnnxRuntimeModuleV1, scope: AssistanceRuntimeFamilyWorkerExecutionContext,
		key: string, modelPath: string, settings: Parameters<AssistanceOnnxRuntimeModuleV1['InferenceSession']['create']>[1],
	): Promise<OnnxSessionEntry> {
		const session = await runtime.InferenceSession.create(modelPath, settings);
		try {
			this.#assertScope(scope);
			if (!Array.isArray(session.inputNames) || !Array.isArray(session.outputNames)
				|| typeof session.run !== 'function' || typeof session.release !== 'function') {
				throw new TypeError('Resident ONNX sessions require a complete releasable native surface.');
			}
		} catch (error) { await session.release?.(); throw error; }
		const entry = { key, modelBytes: scope.grant.models.reduce((total, item) => total + item.byteLength, 0), session, runs: new Set<Promise<unknown>>(), leases: 0 };
		this.#entries.set(key, entry);
		return entry;
	}

	async dispose(): Promise<void> {
		this.#closed = true;
		this.#clearTimer();
		await this.#retire();
	}

	#assertScope(scope: AssistanceRuntimeFamilyWorkerExecutionContext): void {
		if (this.#closed || this.#active !== scope) throw new Error('The ONNX request lease belongs to a retired scope.');
		scope.signal?.throwIfAborted();
	}

	#clearTimer(): void { if (this.#timer) clearTimeout(this.#timer); this.#timer = null; }

	#retire(): Promise<void> {
		const creations = [...this.#creations.values()];
		this.#retirement = this.#retirement.then(async () => {
			await Promise.allSettled(creations);
			const entries = [...this.#entries.values()];
			this.#entries.clear();
			const results = await Promise.allSettled(entries.map(releaseOnnxEntry));
			const failures = results.filter((entry): entry is PromiseRejectedResult => entry.status === 'rejected')
				.map((entry) => entry.reason as unknown);
			if (failures.length) throw new AggregateError(failures, 'ONNX native session release failed.', { cause: failures[0] });
		});
		return this.#retirement;
	}
}

async function releaseOnnxEntry(entry: OnnxSessionEntry): Promise<void> {
	await Promise.allSettled([...entry.runs]);
	await entry.session.release?.();
}

function lowerBound(value: number | undefined, ceiling: number, name: string): number {
	if (value === undefined) return ceiling;
	if (!Number.isSafeInteger(value) || value < 1 || value > ceiling) throw new RangeError(`${name} must be between 1 and ${ceiling}.`);
	return value;
}

type AssistanceOnnxOutputBody = Uint8Array | readonly Uint8Array[];

/** Admit only the authenticated, task-bound CPU ONNX job; callers own their error wording. */
export function assertAssistanceOnnxCpuJobV1(
	context: AssistanceRuntimeFamilyWorkerExecutionContext,
	task: AssistanceRuntimeFamilyTask,
	errorMessage: string,
): void {
	if (context.grant.familyId !== 'onnxruntime-node' || context.grant.task !== task
		|| context.job.descriptor.familyId !== 'onnxruntime-node'
		|| context.job.descriptor.runtimeVersion !== '1.29.0'
		|| context.job.descriptor.executionProvider !== 'cpu') {
		throw new TypeError(errorMessage);
	}
}

export function reviewAssistanceOnnxRuntimeModuleV1(
	value: unknown,
	errors: AssistanceOnnxSurfaceErrorsV1,
): AssistanceOnnxRuntimeModuleV1 {
	if (!value || typeof value !== 'object') throw new TypeError(errors.value);
	const candidate = value as Partial<AssistanceOnnxRuntimeModuleV1>;
	if (typeof candidate.Tensor !== 'function' || !candidate.InferenceSession
		|| typeof candidate.InferenceSession.create !== 'function') {
		throw new TypeError(errors.surface);
	}
	return candidate as AssistanceOnnxRuntimeModuleV1;
}

export async function createAssistanceOnnxCpuSessionV1(
	runtime: AssistanceOnnxRuntimeModuleV1,
	modelPath: string,
	errors: AssistanceOnnxSurfaceErrorsV1,
): Promise<AssistanceOnnxInferenceSessionV1> {
	const value = await runtime.InferenceSession.create(modelPath, {
		executionProviders: ['cpu'], graphOptimizationLevel: 'all',
		interOpNumThreads: 1, intraOpNumThreads: 4,
	});
	if (!value || typeof value !== 'object') throw new TypeError(errors.value);
	const session = value as Partial<AssistanceOnnxInferenceSessionV1>;
	if (!Array.isArray(session.inputNames) || !Array.isArray(session.outputNames)
		|| typeof session.run !== 'function'
		|| session.release !== undefined && typeof session.release !== 'function') {
		throw new TypeError(errors.surface);
	}
	return session as AssistanceOnnxInferenceSessionV1;
}

export async function publishAssistanceOnnxOutputV1(
	context: AssistanceRuntimeFamilyWorkerExecutionContext,
	bodyValue: AssistanceOnnxOutputBody | (() => AssistanceOnnxOutputBody),
	reservationError: string,
	options: AssistanceOnnxOutputPublicationOptionsV1 = {},
): Promise<AssistanceRuntimeFamilyJobResultV1> {
	context.signal?.throwIfAborted();
	const body = typeof bodyValue === 'function' ? bodyValue() : bodyValue;
	const chunks: readonly Uint8Array[] = body instanceof Uint8Array ? [body] : body;
	const byteLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
	const output = context.grant.outputs[0]!;
	if (options.exactOutputCount !== undefined
		&& context.grant.outputs.length !== options.exactOutputCount
		|| !Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > output.maximumByteLength) {
		throw new RangeError(reservationError);
	}
	await writeFile(output.path, chunks);
	context.signal?.throwIfAborted();
	context.onProgress(1);
	const digest = createHash('sha256');
	for (const chunk of chunks) digest.update(chunk);
	return Object.freeze({
		resultVersion: 1, jobId: context.grant.jobId,
		familyId: context.grant.familyId, task: context.grant.task,
		outputs: Object.freeze([Object.freeze({
			claimId: output.claimId, role: output.role, mediaType: output.mediaType,
			byteLength,
			sha256: digest.digest('hex'),
		})]),
	});
}

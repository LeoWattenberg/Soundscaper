/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Binding the consolidate operation to the project's real storage.
 *
 * The operation decides the sequencing and owns the refusals; this only says
 * what its ports mean here. Two of those meanings are worth stating outright.
 *
 * "Rebinding" a consolidated source is **unlinking** it. A source with no
 * linked-original binding is one whose bytes live in managed storage — that is
 * what the plan already means by `already-managed` — so the copy is written
 * under the source's own key while the link still stands, and the link is then
 * dropped under its compare-and-swap fence. Nothing reads the managed body
 * until that fence releases, which is what makes the operation's copy-then-flip
 * ordering true of this storage and not just of its own port shape.
 *
 * Reachability is resolved before the plan is built, not inside it. The plan
 * asks a synchronous question because a plan is a pure value; finding out
 * whether a file is still there is a platform round trip, so it happens here
 * and the plan is handed the answers.
 */

import {
	createConsolidatePlan,
	type ConsolidateBinding,
	type ConsolidatePlan,
	type ConsolidateSourcePlan,
} from '../consolidate-plan.ts';
import {
	runConsolidate,
	type ConsolidatePorts,
	type ConsolidateRunResult,
} from '../consolidate-operation.ts';

/** The narrow slice of the project store this needs, named rather than assumed. */
export interface ConsolidateMediaStore {
	getLinkedOriginalBinding(
		projectId: string,
		sourceId: string,
	): Promise<Readonly<Record<string, unknown>> | null>;
	resolveLinkedAudioOriginal(
		projectId: string,
		source: unknown,
		options?: Readonly<{ signal?: AbortSignal }>,
	): Promise<Readonly<{ blob: Blob }> | null>;
	resolveLinkedVideoOriginal(
		projectId: string,
		source: unknown,
		options?: Readonly<{ signal?: AbortSignal }>,
	): Promise<Readonly<{ blob: Blob }> | null>;
	beginMediaAssetWrite(
		sourceId: string,
		metadata: Readonly<Record<string, unknown>>,
		options: Readonly<{ expectedBytes: number; expectedSha256: string; signal?: AbortSignal }>,
	): Promise<MediaAssetWriterLike>;
	loadMediaAsset(
		sourceId: string,
		options?: Readonly<{ signal?: AbortSignal }>,
	): Promise<BlobLike | null>;
	unlinkLinkedAudioOriginal(
		projectId: string,
		sourceId: string,
		expectedBindingToken: string,
	): Promise<boolean>;
	unlinkLinkedVideoOriginal(
		projectId: string,
		sourceId: string,
		expectedBindingToken: string,
	): Promise<boolean>;
}

interface BlobLike {
	readonly size: number;
	stream?(): ReadableStream<Uint8Array>;
	slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> };
}

export interface MediaAssetWriterLike {
	readonly maximumChunkBytes: number;
	write(bytes: Uint8Array, options?: Readonly<{ signal?: AbortSignal }>): Promise<void>;
	commit(options?: Readonly<{ signal?: AbortSignal }>): Promise<Readonly<Record<string, unknown>>>;
	abort(): Promise<void>;
}

export interface ConsolidateProjectRequest {
	readonly projectId: string;
	readonly project: Readonly<Record<string, unknown>>;
	readonly store: ConsolidateMediaStore;
	readonly signal?: AbortSignal;
	readonly assertCurrent?: () => void;
	readonly onProgress?: (progress: Readonly<{ completed: number; total: number }>) => void;
}

const DEFAULT_CHUNK_BYTES = 1024 * 1024;

/** Read the project's linked-original bindings and say which are reachable now. */
export async function planProjectConsolidation(
	request: ConsolidateProjectRequest,
): Promise<ConsolidatePlan> {
	const bindings: ConsolidateBinding[] = [];
	const reachable = new Set<string>();
	for (const source of projectSources(request.project)) {
		throwIfAborted(request.signal);
		const sourceId = String(source.id ?? '');
		if (!sourceId) continue;
		const record = await request.store.getLinkedOriginalBinding(request.projectId, sourceId);
		throwIfAborted(request.signal);
		const binding = consolidateBinding(record);
		if (!binding) continue;
		bindings.push(binding);
		if (await isOriginalReachable(request, source, binding)) reachable.add(sourceId);
	}
	throwIfAborted(request.signal);
	return createConsolidatePlan({
		project: request.project,
		bindings,
		isReachable: (binding) => reachable.has(binding.sourceId),
	});
}

/** Plan and run in one call, which is what a caller almost always wants. */
export async function consolidateProjectMedia(
	request: ConsolidateProjectRequest,
): Promise<Readonly<{ plan: ConsolidatePlan; run: ConsolidateRunResult }>> {
	const plan = await planProjectConsolidation(request);
	const run = await runConsolidate(plan, createConsolidateMediaPorts(request), {
		...(request.signal ? { signal: request.signal } : {}),
		...(request.assertCurrent ? { assertCurrent: request.assertCurrent } : {}),
		...(request.onProgress ? { onProgress: request.onProgress } : {}),
	});
	return Object.freeze({ plan, run });
}

export function createConsolidateMediaPorts(request: ConsolidateProjectRequest): ConsolidatePorts {
	const { store, projectId } = request;
	const sources = new Map(projectSources(request.project).map((source) => [String(source.id ?? ''), source]));
	const ports: ConsolidatePorts = {
		async *readOriginal(source, options) {
			const projectSource = sources.get(source.sourceId);
			if (!projectSource) throw new Error(`The project no longer contains source ${source.sourceId}.`);
			const resolved = source.kind === 'video'
				? await store.resolveLinkedVideoOriginal(projectId, projectSource, options)
				: await store.resolveLinkedAudioOriginal(projectId, projectSource, options);
			if (!resolved?.blob) throw new Error(`The linked original for ${source.sourceId} could not be read.`);
			yield* blobChunks(resolved.blob, DEFAULT_CHUNK_BYTES, options.signal);
		},
		async writeManaged(source, chunks, options) {
			if (!source.sha256) throw new Error(`Consolidating ${source.sourceId} requires its recorded digest.`);
			// The storage layer is told what it is receiving, so a body that is not
			// the recorded one is refused there as well as reported here.
			const writer = await store.beginMediaAssetWrite(source.sourceId, {
				mimeType: '',
			}, {
				expectedBytes: source.byteLength,
				expectedSha256: source.sha256,
				...(options.signal ? { signal: options.signal } : {}),
			});
			let byteLength = 0;
			try {
				for await (const chunk of chunks) {
					for (let offset = 0; offset < chunk.byteLength; offset += writer.maximumChunkBytes) {
						await writer.write(
							chunk.subarray(offset, Math.min(chunk.byteLength, offset + writer.maximumChunkBytes)),
							options.signal ? { signal: options.signal } : undefined,
						);
					}
					byteLength += chunk.byteLength;
				}
				await writer.commit(options.signal ? { signal: options.signal } : undefined);
			} catch (error) {
				await writer.abort().catch(() => undefined);
				throw error;
			}
			return Object.freeze({ storageKey: source.sourceId, byteLength });
		},
		async *readManaged(storageKey, options) {
			const blob = await store.loadMediaAsset(storageKey, options);
			if (!blob) throw new Error(`The managed copy for ${storageKey} could not be read back.`);
			yield* blobChunks(blob, DEFAULT_CHUNK_BYTES, options.signal);
		},
		async rebind(rebindRequest) {
			// Unlinking is the rebind: with the link gone, the source reads from the
			// managed copy that was written under its own key and verified above.
			const source = sources.get(rebindRequest.sourceId);
			const kind = String(source?.kind ?? '') === 'video' ? 'video' : 'audio';
			return kind === 'video'
				? store.unlinkLinkedVideoOriginal(
					projectId, rebindRequest.sourceId, rebindRequest.expectedBindingToken,
				)
				: store.unlinkLinkedAudioOriginal(
					projectId, rebindRequest.sourceId, rebindRequest.expectedBindingToken,
				);
		},
		async discardManaged() {
			// Deliberately nothing. A managed body is immutable once committed, and
			// an unreferenced one is collected by ordinary media maintenance; making
			// this operation delete media would give it the one power the
			// linked-media lifecycle says it must not have.
		},
	};
	return Object.freeze(ports);
}

async function isOriginalReachable(
	request: ConsolidateProjectRequest,
	source: Readonly<Record<string, unknown>>,
	binding: ConsolidateBinding,
): Promise<boolean> {
	throwIfAborted(request.signal);
	try {
		const resolved = binding.kind === 'video'
			? await request.store.resolveLinkedVideoOriginal(request.projectId, source, {
				...(request.signal ? { signal: request.signal } : {}),
			})
			: await request.store.resolveLinkedAudioOriginal(request.projectId, source, {
				...(request.signal ? { signal: request.signal } : {}),
			});
		throwIfAborted(request.signal);
		return Boolean(resolved?.blob);
	} catch {
		throwIfAborted(request.signal);
		// A drive that is not there answers by failing. That is an ordinary
		// outcome for this question, not an error the run should carry.
		return false;
	}
}

function consolidateBinding(value: unknown): ConsolidateBinding | null {
	if (!value || typeof value !== 'object') return null;
	const record = value as Readonly<Record<string, unknown>>;
	const sourceId = String(record.sourceId ?? '');
	const storageKey = String(record.storageKey ?? '');
	const sha256 = String(record.sha256 ?? '');
	const bindingToken = String(record.bindingToken ?? '');
	const byteLength = Number(record.byteLength);
	const kind = record.kind === 'video' ? 'video' : 'audio';
	if (!sourceId || !storageKey || !sha256 || !bindingToken
		|| !Number.isSafeInteger(byteLength) || byteLength < 0) {
		return null;
	}
	return Object.freeze({ sourceId, storageKey, byteLength, sha256, bindingToken, kind });
}

async function* blobChunks(
	blob: BlobLike,
	chunkBytes: number,
	signal: AbortSignal | undefined,
): AsyncGenerator<Uint8Array> {
	if (typeof blob.stream === 'function') {
		const reader = blob.stream().getReader();
		try {
			while (true) {
				if (signal?.aborted) throw signal.reason ?? abortError();
				const { done, value } = await reader.read();
				if (done) break;
				if (value) yield value;
			}
		} finally {
			await reader.cancel().catch(() => undefined);
		}
		return;
	}
	for (let offset = 0; offset < blob.size; offset += chunkBytes) {
		if (signal?.aborted) throw signal.reason ?? abortError();
		const end = Math.min(blob.size, offset + chunkBytes);
		yield new Uint8Array(await blob.slice(offset, end).arrayBuffer());
	}
}

function projectSources(
	project: Readonly<Record<string, unknown>>,
): readonly Readonly<Record<string, unknown>>[] {
	const sources = project?.sources;
	return (Array.isArray(sources) ? sources : []).filter(
		(value): value is Readonly<Record<string, unknown>> => Boolean(value) && typeof value === 'object',
	);
}

function abortError(): Error {
	return typeof DOMException === 'function'
		? new DOMException('The operation was aborted.', 'AbortError')
		: Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw signal.reason ?? abortError();
}

export type { ConsolidatePlan, ConsolidateRunResult, ConsolidateSourcePlan };

/* SPDX-License-Identifier: AGPL-3.0-only */

import { compareCodeUnits } from '../code-unit-order.ts';
import {
	TAKE_CYCLE_CAPTURE_MAXIMUM_SPANS,
	planExactTakeCycleCapture,
	type TakeCycleCaptureSpan,
} from '../take-cycle-capture-domain.ts';
import type { SourceRepository } from '../storage/source-repository.ts';
import { WAVPACK_PCM_MAXIMUM_FRAMES } from '../wavpack/pcm.js';
import { TAKE_CYCLE_CAPTURE_MAXIMUM_CHUNK_BYTES } from './take-cycle-capture-pcm-evidence.ts';
import {
	capturePlan,
	normalizeDraft,
	normalizeStoredDraft,
	sameDraft,
} from './take-cycle-capture-spool-manifest.ts';
import {
	passEvidenceFromStoredCapture,
	storedCaptureGeometry,
} from './take-cycle-committed-capture-spool.ts';
import type {
	TakeCycleCapturingSpoolEvidence,
	TakeCycleLiveCaptureSeed,
	TakeCycleLiveCaptureSpool,
	TakeCycleLiveCaptureWriter,
} from './take-cycle-live-capture-spool.ts';
import type {
	TakeCycleLaneTarget,
	TakeCycleSourceDescription,
} from './take-cycle-recording-repository-composition.ts';
import type { TakeCycleLaneFinalizationRequest } from './take-cycle-recording-service.ts';

const DRAFT_VERSION = 1 as const;
const DRAFT_MARKER = 'take-cycle-capture-draft-v1';
export { TAKE_CYCLE_CAPTURE_MAXIMUM_CHUNK_BYTES } from './take-cycle-capture-pcm-evidence.ts';

export interface TakeCycleCapturePcmSpan extends TakeCycleCaptureSpan {
	readonly channels: readonly Float32Array[];
}

export interface TakeCycleCapturePassIdentities {
	readonly laneId: string;
	readonly takeId: string;
	readonly mediaId: string;
	readonly journalId: string;
}

export interface TakeCycleCaptureDraftSource extends TakeCycleSourceDescription {
	readonly mediaId: string;
}

export interface TakeCycleCommittedCaptureSpool {
	readonly draftId: string;
	readonly captureSpans: readonly TakeCycleCaptureSpan[];
}

export interface TakeCycleCaptureDraft {
	readonly version: typeof DRAFT_VERSION;
	readonly draftId: string;
	readonly draftToken: string;
	readonly projectId: string;
	readonly publicationGeneration: number;
	readonly lane: TakeCycleLaneFinalizationRequest;
	readonly target: TakeCycleLaneTarget;
	readonly sources: readonly TakeCycleCaptureDraftSource[];
}

export interface TakeCycleCaptureDraftSeed {
	readonly draftId: string;
	readonly projectId: string;
	readonly publicationGeneration: number;
	readonly envelopeId: string;
	readonly groupId: string;
	readonly laneId: string;
	readonly loopStartSample: number;
	readonly loopEndSample: number;
	readonly target: TakeCycleLaneTarget;
	readonly source: Omit<TakeCycleSourceDescription, 'frameCount'>;
	readonly capture: Readonly<
		| { readonly kind: 'stream'; readonly spans: AsyncIterable<TakeCycleCapturePcmSpan> }
		| { readonly kind: 'committed'; readonly spool: TakeCycleCommittedCaptureSpool }
	>;
	createPassIdentities(passIndex: number, firstLaneId: string): TakeCycleCapturePassIdentities;
}

export interface TakeCycleCaptureSpool {
	allocateGeneration(projectId: string): Promise<number>;
	beginLive(seed: TakeCycleLiveCaptureSeed): Promise<TakeCycleLiveCaptureWriter>;
	persist(seed: TakeCycleCaptureDraftSeed, options?: { readonly signal?: AbortSignal }): Promise<TakeCycleCaptureDraft>;
	list(projectId: string): Promise<readonly TakeCycleCaptureDraft[]>;
	inspect(projectId: string): Promise<Readonly<{
		readonly drafts: readonly TakeCycleCaptureDraft[];
		readonly capturing: readonly TakeCycleCapturingSpoolEvidence[];
		readonly capturingCount: number;
	}>>;
	resolveOpenCaptures(
		projectId: string,
		decision: 'recover' | 'discard',
		createPassIdentities: (passIndex: number, firstLaneId: string) => TakeCycleCapturePassIdentities,
	): Promise<readonly TakeCycleCaptureDraft[]>;
	readPass(
		draft: TakeCycleCaptureDraft,
		mediaId: string,
		options?: { readonly signal?: AbortSignal },
	): AsyncIterable<readonly Float32Array[]>;
	remove(draft: TakeCycleCaptureDraft): Promise<boolean>;
}

type CaptureSourcePort = Pick<SourceRepository,
	'beginWrite' | 'getMetadata' | 'replaceMetadataIfCurrent' | 'list' | 'chunks' | 'discardIfCurrent'
>;

/** Compose pre-registered live PCM with adopted canonical-source capture drafts. */
export function createTakeCycleCaptureSourceSpool(
	sources: CaptureSourcePort,
	live: TakeCycleLiveCaptureSpool,
): Readonly<TakeCycleCaptureSpool> {
	const origins = new Map<string, 'live' | 'source'>();
	return Object.freeze({
		allocateGeneration: (projectId: string) => live.allocateGeneration(projectId),
		beginLive, persist, list, inspect, resolveOpenCaptures, readPass, remove,
	});

	async function beginLive(seed: TakeCycleLiveCaptureSeed): Promise<TakeCycleLiveCaptureWriter> {
		const writer = await live.begin(seed);
		return Object.freeze({
			draftId: writer.draftId,
			spoolToken: writer.spoolToken,
			get frameCount() { return writer.frameCount; },
			append: writer.append,
			discard: writer.discard,
			async seal(options?: { readonly signal?: AbortSignal }) {
				const draft = await writer.seal(options);
				origins.set(draft.draftId, 'live');
				return draft;
			},
		});
	}

	async function persist(
		seedValue: TakeCycleCaptureDraftSeed,
		{ signal }: { readonly signal?: AbortSignal } = {},
	): Promise<TakeCycleCaptureDraft> {
		const seed = normalizeSeed(seedValue);
		const draft = seed.capture.kind === 'committed'
			? await adoptCommitted(seed, seed.capture.spool, signal)
			: await live.persist(seed, signal ? { signal } : {});
		origins.set(draft.draftId, seed.capture.kind === 'committed' ? 'source' : 'live');
		return draft;
	}

	async function adoptCommitted(
		seed: NormalizedSeed,
		spoolValue: TakeCycleCommittedCaptureSpool,
		signal?: AbortSignal,
	): Promise<TakeCycleCaptureDraft> {
		const spoolId = stableId(spoolValue.draftId, 'take cycle committed spool ID');
		if (spoolId !== seed.draftId) throw new Error('Committed take cycle spool ID must equal its stable envelope ID.');
		const stored = await sources.getMetadata(spoolId);
		if (!stored) throw new Error(`Committed take cycle spool ${spoolId} is unavailable.`);
		if (stored.takeCycleCaptureDraftVersion != null || stored.takeCycleCaptureDraft != null) {
			throw new Error('Committed take cycle spool already carries a capture draft manifest.');
		}
		const spans = denseArray(spoolValue.captureSpans, TAKE_CYCLE_CAPTURE_MAXIMUM_SPANS).map((value, index) => {
			const record = dataRecord(value, `take cycle committed capture span ${String(index)}`);
			return Object.freeze({
				startSample: nonNegativeInteger(record.startSample, 'take cycle span startSample'),
				endSample: nonNegativeInteger(record.endSample, 'take cycle span endSample'),
			});
		});
		const geometry = storedCaptureGeometry(stored, spans, seed);
		const evidence = await passEvidenceFromStoredCapture(sources, stored, spans, seed, signal);
		const identities = evidence.map((_, passIndex) => normalizePassIdentities(
			seed.createPassIdentities(passIndex, seed.laneId),
		));
		const plan = planExactTakeCycleCapture({
			groupId: seed.groupId,
			laneId: seed.laneId,
			laneIds: identities.map(({ laneId }) => laneId),
			loopStartSample: seed.loopStartSample,
			loopEndSample: seed.loopEndSample,
			captureSpans: spans,
			takeIds: identities.map(({ takeId }) => takeId),
			interrupted: geometry.interrupted,
		});
		if (plan.passes.length !== evidence.length) throw new Error('Committed capture evidence does not cover every pass.');
		const publications = plan.passes.map((_pass, index) => Object.freeze({
			...identities[index]!,
			...evidence[index]!,
		}));
		const draftData = Object.freeze({
			version: DRAFT_VERSION,
			draftId: seed.draftId,
			projectId: seed.projectId,
			publicationGeneration: seed.publicationGeneration,
			lane: Object.freeze({
				envelopeId: seed.envelopeId,
				groupId: seed.groupId,
				laneId: seed.laneId,
				loopStartSample: seed.loopStartSample,
				loopEndSample: seed.loopEndSample,
				captureSpans: Object.freeze(spans),
				interrupted: geometry.interrupted,
				publications: Object.freeze(publications),
			}),
			target: seed.target,
			sources: Object.freeze(plan.passes.map((pass, index) => Object.freeze({
				mediaId: publications[index]!.mediaId,
				...seed.source,
				frameCount: pass.captureEndSample - pass.captureStartSample,
			}))),
		});
		const metadata = {
			...stored,
			type: DRAFT_MARKER,
			takeCycleCaptureDraftVersion: DRAFT_VERSION,
			takeCycleCaptureDraft: draftData,
		};
		if (!await sources.replaceMetadataIfCurrent(stored, metadata)) {
			throw new Error('Committed take cycle spool changed before manifest publication.');
		}
		return normalizeStoredDraft(metadata);
	}

	async function list(projectIdValue: string): Promise<readonly TakeCycleCaptureDraft[]> {
		return (await inspect(projectIdValue)).drafts;
	}

	async function inspect(projectIdValue: string): Promise<Readonly<{
		readonly drafts: readonly TakeCycleCaptureDraft[];
		readonly capturing: readonly TakeCycleCapturingSpoolEvidence[];
		readonly capturingCount: number;
	}>> {
		const projectId = stableId(projectIdValue, 'take cycle capture projectId');
		const inventory = await live.inspect(projectId);
		const drafts: TakeCycleCaptureDraft[] = [...inventory.drafts];
		for (const draft of inventory.drafts) origins.set(draft.draftId, 'live');
		for (const record of await sources.list()) {
			if (record.takeCycleCaptureDraftVersion !== DRAFT_VERSION) continue;
			const draft = normalizeStoredDraft(record);
			if (draft.projectId === projectId) {
				if (origins.has(draft.draftId) && origins.get(draft.draftId) !== 'source') {
					throw new Error(`Take cycle draft ${draft.draftId} has conflicting storage.`);
				}
				origins.set(draft.draftId, 'source');
				drafts.push(draft);
			}
		}
		return Object.freeze({
			drafts: Object.freeze(drafts.sort((left, right) => compareCodeUnits(left.draftId, right.draftId))),
			capturing: inventory.capturing,
			capturingCount: inventory.capturingCount,
		});
	}

	async function resolveOpenCaptures(
		projectId: string,
		decision: 'recover' | 'discard',
		createPassIdentities: (passIndex: number, firstLaneId: string) => TakeCycleCapturePassIdentities,
	): Promise<readonly TakeCycleCaptureDraft[]> {
		const drafts = await live.resolve(projectId, decision, createPassIdentities);
		for (const draft of drafts) origins.set(draft.draftId, 'live');
		return drafts;
	}

	function readPass(
		draftValue: TakeCycleCaptureDraft,
		mediaIdValue: string,
		{ signal }: { readonly signal?: AbortSignal } = {},
	): AsyncIterable<readonly Float32Array[]> {
		const draft = normalizeDraft(draftValue, draftValue.draftToken);
		const mediaId = stableId(mediaIdValue, 'take cycle capture mediaId');
		if (origins.get(draft.draftId) === 'live') {
			return live.readPass(draft, mediaId, signal ? { signal } : {});
		}
		const source = draft.sources.find((candidate) => candidate.mediaId === mediaId);
		const passIndex = draft.lane.publications.findIndex((publication) => publication.mediaId === mediaId);
		if (!source || passIndex < 0) throw new ReferenceError(`Unknown take cycle capture media: ${mediaId}.`);
		return readStoredPass(draft, source, passIndex, signal);
	}

	async function* readStoredPass(
		draft: TakeCycleCaptureDraft,
		source: TakeCycleCaptureDraftSource,
		passIndex: number,
		signal?: AbortSignal,
	): AsyncGenerator<readonly Float32Array[]> {
		const stored = await sources.getMetadata(draft.draftId);
		if (!stored || stored.sourceToken !== draft.draftToken) {
			throw new Error('Take cycle capture draft storage ownership changed.');
		}
		const current = normalizeStoredDraft(stored);
		if (!sameDraft(current, draft)) throw new Error('Take cycle capture draft manifest changed.');
		const plan = capturePlan(draft.lane);
		const pass = plan.passes[passIndex]!;
		const buffers = Array.from({ length: source.channelCount }, () => new Float32Array(source.chunkFrames));
		let bufferedFrames = 0;
		let writtenFrames = 0;
		let expectedChunkIndex = 0;
		for await (const chunk of sources.chunks(draft.draftId, {
			...(signal ? { signal } : {}), expectedSource: stored,
		})) {
			throwIfAborted(signal);
			const span = draft.lane.captureSpans[expectedChunkIndex];
			if (!span || Number(chunk.index) !== expectedChunkIndex
				|| chunk.frames !== span.endSample - span.startSample
				|| chunk.channels.length !== source.channelCount
				|| chunk.channels.some((channel) => !(channel instanceof Float32Array)
					|| channel.length !== chunk.frames)) {
				throw new Error('Take cycle capture spool has noncanonical chunk geometry.');
			}
			expectedChunkIndex += 1;
			const intersectionStart = Math.max(span.startSample, pass.captureStartSample);
			const intersectionEnd = Math.min(span.endSample, pass.captureEndSample);
			if (intersectionStart >= intersectionEnd) {
				if (span.startSample >= pass.captureEndSample) break;
				continue;
			}
			let inputOffset = intersectionStart - span.startSample;
			let remaining = intersectionEnd - intersectionStart;
			while (remaining > 0) {
				const count = Math.min(remaining, source.chunkFrames - bufferedFrames);
				for (let channel = 0; channel < source.channelCount; channel += 1) {
					buffers[channel]!.set(chunk.channels[channel]!.subarray(inputOffset, inputOffset + count), bufferedFrames);
				}
				bufferedFrames += count;
				writtenFrames += count;
				inputOffset += count;
				remaining -= count;
				if (bufferedFrames === source.chunkFrames) {
					yield Object.freeze(buffers.map((channel) => channel.slice()));
					bufferedFrames = 0;
				}
			}
		}
		if (bufferedFrames) {
			yield Object.freeze(buffers.map((channel) => channel.slice(0, bufferedFrames)));
		}
		if (writtenFrames !== source.frameCount) {
			throw new Error('Take cycle capture spool pass is truncated.');
		}
	}

	async function remove(draftValue: TakeCycleCaptureDraft): Promise<boolean> {
		const draft = normalizeDraft(draftValue, draftValue.draftToken);
		if (origins.get(draft.draftId) === 'live') {
			const removed = await live.remove(draft);
			if (removed) origins.delete(draft.draftId);
			return removed;
		}
		const stored = await sources.getMetadata(draft.draftId);
		if (!stored) return true;
		if (stored.sourceToken !== draft.draftToken) return false;
		const current = normalizeStoredDraft(stored);
		if (!sameDraft(current, draft)) return false;
		const removed = await sources.discardIfCurrent(stored);
		if (removed) origins.delete(draft.draftId);
		return removed;
	}
}

interface NormalizedSeed extends Omit<TakeCycleCaptureDraftSeed, 'source' | 'target'> {
	readonly loopSampleCount: number;
	readonly source: Omit<TakeCycleSourceDescription, 'frameCount'>;
	readonly target: TakeCycleLaneTarget;
}

function normalizeSeed(value: TakeCycleCaptureDraftSeed): NormalizedSeed {
	if (!value?.capture || (value.capture.kind !== 'stream' && value.capture.kind !== 'committed')
		|| (value.capture.kind === 'stream'
			&& (!value.capture.spans || typeof value.capture.spans[Symbol.asyncIterator] !== 'function'))) {
		throw new TypeError('Take cycle capture must be a stream or a committed spool.');
	}
	const loopStartSample = nonNegativeInteger(value.loopStartSample, 'take cycle loopStartSample');
	const loopEndSample = nonNegativeInteger(value.loopEndSample, 'take cycle loopEndSample');
	if (loopEndSample <= loopStartSample) throw new RangeError('Take cycle loop extent must be positive.');
	return Object.freeze({
		...value,
		draftId: stableId(value.draftId, 'take cycle draftId'),
		projectId: stableId(value.projectId, 'take cycle projectId'),
		publicationGeneration: positiveInteger(value.publicationGeneration, 'take cycle publicationGeneration'),
		envelopeId: stableId(value.envelopeId, 'take cycle envelopeId'),
		groupId: stableId(value.groupId, 'take cycle groupId'),
		laneId: stableId(value.laneId, 'take cycle laneId'),
		loopStartSample,
		loopEndSample,
		loopSampleCount: loopEndSample - loopStartSample,
		target: normalizeTarget(value.target),
		source: normalizeSourceBase(value.source),
	});
}

function normalizePassIdentities(value: TakeCycleCapturePassIdentities): TakeCycleCapturePassIdentities {
	return Object.freeze({
		laneId: stableId(value?.laneId, 'take cycle pass laneId'),
		takeId: stableId(value?.takeId, 'take cycle takeId'),
		mediaId: stableId(value?.mediaId, 'take cycle mediaId'),
		journalId: stableId(value?.journalId, 'take cycle journalId'),
	});
}

function normalizeTarget(value: unknown): TakeCycleLaneTarget {
	const record = dataRecord(value, 'take cycle lane target');
	return Object.freeze({
		trackId: stableId(record.trackId, 'take cycle trackId'),
		sequenceId: stableId(record.sequenceId, 'take cycle sequenceId'),
	});
}

function normalizeSourceBase(value: unknown): Omit<TakeCycleSourceDescription, 'frameCount'> {
	const record = dataRecord(value, 'take cycle source description');
	const source = {
		name: stableName(record.name),
		sampleRate: boundedPositiveInteger(record.sampleRate, 768_000, 'take cycle sampleRate'),
		channelCount: boundedPositiveInteger(record.channelCount, 64, 'take cycle channelCount'),
		chunkFrames: boundedPositiveInteger(record.chunkFrames, WAVPACK_PCM_MAXIMUM_FRAMES, 'take cycle chunkFrames'),
	};
	if (source.channelCount * source.chunkFrames * Float32Array.BYTES_PER_ELEMENT
		> TAKE_CYCLE_CAPTURE_MAXIMUM_CHUNK_BYTES) {
		throw new RangeError('Take cycle capture PCM chunk exceeds its strict memory bound.');
	}
	return Object.freeze(source);
}

function dataRecord(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be a data record.`);
	return value as Readonly<Record<string, unknown>>;
}

function denseArray(value: unknown, maximum: number): readonly unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
		|| value.length > maximum || Reflect.ownKeys(value).length !== value.length + 1) {
		throw new TypeError('Take cycle capture draft arrays must be bounded, standard, and dense.');
	}
	return value;
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value.length || value !== value.trim()
		|| value !== value.normalize('NFC') || value.length > 256
		|| /[\u0000-\u001f\u007f]/u.test(value)) throw new TypeError(`${name} is invalid.`);
	return value;
}

function stableName(value: unknown): string {
	if (typeof value !== 'string' || !value.length || value !== value.trim() || value.length > 255) {
		throw new TypeError('Take cycle source name is invalid.');
	}
	return value;
}

function positiveInteger(value: unknown, name: string): number {
	return boundedPositiveInteger(value, Number.MAX_SAFE_INTEGER, name);
}

function boundedPositiveInteger(value: unknown, maximum: number, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > maximum) {
		throw new RangeError(`${name} must be a supported positive safe integer.`);
	}
	return Number(value);
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be non-negative.`);
	return Number(value);
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	throw signal.reason instanceof Error ? signal.reason : new DOMException('Take cycle capture aborted.', 'AbortError');
}

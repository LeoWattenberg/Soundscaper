/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	TAKE_CYCLE_CAPTURE_MAXIMUM_PASSES,
	TAKE_CYCLE_CAPTURE_MAXIMUM_SPANS,
	planExactTakeCycleCapture,
	type TakeCycleCaptureSpan,
} from '../take-cycle-capture-domain.ts';
import { digestScapeBytes } from '../scape-archive-media.ts';
import type { RawPcmSpoolRecord, RawPcmSpoolRepository } from '../storage/raw-pcm-spool-repository.ts';
import { WAVPACK_PCM_MAXIMUM_FRAMES } from '../wavpack/pcm.js';
import { TAKE_CYCLE_CAPTURE_MAXIMUM_CHUNK_BYTES } from './take-cycle-capture-pcm-evidence.ts';
import { normalizeDraft, sameDraft } from './take-cycle-capture-spool-manifest.ts';
import { discardTakeCycleLiveCapture } from './take-cycle-live-capture-discard.ts';
import { collectTakeCycleLivePassEvidence } from './take-cycle-live-pass-evidence.ts';
import type {
	TakeCycleCaptureDraft,
	TakeCycleCaptureDraftSeed,
	TakeCycleCapturePassIdentities,
	TakeCycleCapturePcmSpan,
} from './take-cycle-capture-spool.ts';
import type { TakeCycleLaneTarget, TakeCycleSourceDescription } from './take-cycle-recording-repository-composition.ts';

const INTENT_KIND = 'take-cycle-live-capture-intent-v1';
const DRAFT_KIND = 'take-cycle-live-capture-draft-v1';
const TEXT_ENCODER = new TextEncoder();
export interface TakeCycleLiveCaptureInventory {
	readonly drafts: readonly TakeCycleCaptureDraft[];
	readonly capturing: readonly TakeCycleCapturingSpoolEvidence[];
	readonly capturingCount: number;
}

export interface TakeCycleCapturingSpoolEvidence {
	readonly draftId: string;
	readonly draftToken: string;
	readonly publicationGeneration: number;
	readonly groupId: string;
	readonly target: TakeCycleLaneTarget;
	readonly manifestSha256: string;
	readonly state: 'capturing' | 'sealed';
	readonly frameCount: number;
	readonly chunkCount: number;
}

export interface TakeCycleLiveCaptureSpool {
	allocateGeneration(projectId: string): Promise<number>;
	begin(seed: TakeCycleLiveCaptureSeed): Promise<TakeCycleLiveCaptureWriter>;
	persist(seed: TakeCycleCaptureDraftSeed, options?: { readonly signal?: AbortSignal }): Promise<TakeCycleCaptureDraft>;
	inspect(projectId: string): Promise<TakeCycleLiveCaptureInventory>;
	resolve(
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

export type TakeCycleLiveCaptureSeed = Omit<TakeCycleCaptureDraftSeed, 'capture'>;

export interface TakeCycleLiveCaptureWriter {
	readonly draftId: string;
	readonly spoolToken: string;
	readonly frameCount: number;
	append(span: TakeCycleCapturePcmSpan, options?: { readonly signal?: AbortSignal }): Promise<void>;
	seal(options?: { readonly signal?: AbortSignal }): Promise<TakeCycleCaptureDraft>;
	discard(): Promise<void>;
}

interface LiveCaptureIntent {
	readonly kind: typeof INTENT_KIND;
	readonly projectId: string;
	readonly publicationGeneration: number;
	readonly envelopeId: string;
	readonly groupId: string;
	readonly laneId: string;
	readonly loopStartSample: number;
	readonly loopEndSample: number;
	readonly target: TakeCycleLaneTarget;
	readonly source: Omit<TakeCycleSourceDescription, 'frameCount'>;
	readonly captureSpans: readonly TakeCycleCaptureSpan[];
}

/** Pre-registered, incrementally fenced live capture over raw IndexedDB PCM chunks. */
export function createTakeCycleLiveCaptureSpool(
	repository: Pick<RawPcmSpoolRepository,
		'allocateGeneration' | 'create' | 'list' | 'load' | 'append' | 'seal'
		| 'replaceData' | 'chunks' | 'chunk' | 'remove' | 'discard'
	>,
): Readonly<TakeCycleLiveCaptureSpool> {
	return Object.freeze({
		allocateGeneration: (projectId: string) => repository.allocateGeneration(projectId),
		begin, persist, inspect, resolve, readPass, remove,
	});

	async function begin(seedValue: TakeCycleLiveCaptureSeed): Promise<TakeCycleLiveCaptureWriter> {
		const seed = normalizeSeed(seedValue);
		let intent = intentFromSeed(seed);
		let record = await repository.create({
			projectId: intent.projectId,
			spoolId: intent.envelopeId,
			sampleRate: intent.source.sampleRate,
			channelCount: intent.source.channelCount,
			chunkFrames: intent.source.chunkFrames,
			data: intent,
		});
		let busy = false;
		let terminal: 'open' | 'sealing' | 'sealed' | 'discarded' = 'open';
		let discardPromise: Promise<void> | null = null;
		return Object.freeze({
			draftId: intent.envelopeId,
			spoolToken: record.spoolToken,
			get frameCount() { return record.frameCount; },
			async append(
				spanValue: TakeCycleCapturePcmSpan,
				{ signal }: { readonly signal?: AbortSignal } = {},
			) {
				if (terminal !== 'open') throw new Error('Take cycle live capture is already settled.');
				if (busy) throw new Error('Take cycle live capture operations must be awaited serially.');
				busy = true;
				try {
					throwIfAborted(signal);
					if (intent.captureSpans.length >= TAKE_CYCLE_CAPTURE_MAXIMUM_SPANS) {
						throw new RangeError(`Cycle capture exceeds ${String(TAKE_CYCLE_CAPTURE_MAXIMUM_SPANS)} spans.`);
					}
					const expectedStart = intent.captureSpans.at(-1)?.endSample ?? intent.loopStartSample;
					const span = snapshotSpan(spanValue, expectedStart, intent.source);
					const nextIntent = Object.freeze({
						...intent,
						captureSpans: Object.freeze([...intent.captureSpans, {
							startSample: span.startSample, endSample: span.endSample,
						}]),
					});
					const nextRecord = await repository.append(record, span.channels, nextIntent);
					intent = nextIntent;
					record = nextRecord;
				} finally {
					busy = false;
				}
			},
			async seal({ signal }: { readonly signal?: AbortSignal } = {}) {
				if (terminal !== 'open') throw new Error('Take cycle live capture is already settled.');
				if (busy) throw new Error('Take cycle live capture operations must be awaited serially.');
				throwIfAborted(signal);
				if (!intent.captureSpans.length) throw new RangeError('Take cycle capture requires at least one PCM span.');
				terminal = 'sealing';
				try {
					record = await repository.seal(record, intent);
					const draft = await materialize(record, intent, seed.createPassIdentities, signal);
					terminal = 'sealed';
					return draft;
				} catch (error) {
					terminal = 'open';
					throw error;
				}
			},
			discard() {
				if (discardPromise) return discardPromise;
				if (terminal === 'sealed') return Promise.reject(new Error('Take cycle live capture is already sealed.'));
				if (terminal === 'sealing' || busy) {
					return Promise.reject(new Error('Take cycle live capture operations must be awaited serially.'));
				}
				terminal = 'discarded';
				// A seal that failed after its durable transition can only be reclaimed by removal.
				discardPromise = record.state === 'capturing'
					? discardTakeCycleLiveCapture(repository, record, intent)
					: reclaim(record);
				return discardPromise;
			},
		});
	}

	async function reclaim(record: RawPcmSpoolRecord): Promise<void> {
		if (!await repository.remove(record)) throw new Error('Take cycle live capture could not reclaim its settled prefix.');
	}

	async function persist(
		seedValue: TakeCycleCaptureDraftSeed,
		{ signal }: { readonly signal?: AbortSignal } = {},
	): Promise<TakeCycleCaptureDraft> {
		if (seedValue.capture.kind !== 'stream') throw new Error('Live capture requires a PCM span stream.');
		const writer = await begin(seedValue);
		for await (const span of seedValue.capture.spans) {
			await writer.append(span, signal ? { signal } : {});
		}
		return writer.seal(signal ? { signal } : {});
	}

	async function inspect(projectIdValue: string): Promise<TakeCycleLiveCaptureInventory> {
		const projectId = stableId(projectIdValue, 'take cycle projectId');
		const drafts: TakeCycleCaptureDraft[] = [];
		const capturing: TakeCycleCapturingSpoolEvidence[] = [];
		for (const record of await repository.list(projectId)) {
			if (record.state === 'discarded' || record.state === 'deleting') {
				await repository.remove(record);
				continue;
			}
			const data = dataRecord(record.data, 'take cycle live capture data');
			if (data.kind === DRAFT_KIND) drafts.push(draftFromRecord(record));
			else {
				const intent = normalizeIntent(record.data, record);
				capturing.push(Object.freeze({
					draftId: record.spoolId,
					draftToken: record.spoolToken,
					publicationGeneration: intent.publicationGeneration,
					groupId: intent.groupId,
					target: intent.target,
					manifestSha256: digestScapeBytes(TEXT_ENCODER.encode(JSON.stringify(intent))),
					state: record.state,
					frameCount: record.frameCount,
					chunkCount: record.chunkCount,
				}));
			}
		}
		return Object.freeze({
			drafts: Object.freeze(drafts),
			capturing: Object.freeze(capturing),
			capturingCount: capturing.length,
		});
	}

	async function resolve(
		projectIdValue: string,
		decision: 'recover' | 'discard',
		createPassIdentities: (passIndex: number, firstLaneId: string) => TakeCycleCapturePassIdentities,
	): Promise<readonly TakeCycleCaptureDraft[]> {
		const projectId = stableId(projectIdValue, 'take cycle projectId');
		const drafts: TakeCycleCaptureDraft[] = [];
		for (let record of await repository.list(projectId)) {
			if (decision === 'discard' || record.state === 'discarded'
				|| record.state === 'deleting' || record.frameCount === 0) {
				if (!await repository.remove(record)) throw new Error(`Live capture spool ${record.spoolId} changed before removal.`);
				continue;
			}
			const data = dataRecord(record.data, 'take cycle live capture data');
			if (data.kind === DRAFT_KIND) {
				drafts.push(draftFromRecord(record));
				continue;
			}
			const intent = normalizeIntent(record.data, record);
			if (record.state === 'capturing') record = await repository.seal(record, intent);
			drafts.push(await materialize(record, intent, createPassIdentities));
		}
		return Object.freeze(drafts);
	}

	function readPass(
		draftValue: TakeCycleCaptureDraft,
		mediaIdValue: string,
		{ signal }: { readonly signal?: AbortSignal } = {},
	): AsyncIterable<readonly Float32Array[]> {
		const mediaId = stableId(mediaIdValue, 'take cycle mediaId');
		return readStoredPass(draftValue, mediaId, signal);
	}

	async function* readStoredPass(
		draftValue: TakeCycleCaptureDraft,
		mediaId: string,
		signal?: AbortSignal,
	): AsyncGenerator<readonly Float32Array[]> {
		const record = await ownedRecord(draftValue);
		const draft = draftFromRecord(record);
		if (!sameDraft(draft, draftValue)) throw new Error('Live capture draft manifest changed.');
		const source = draft.sources.find((candidate) => candidate.mediaId === mediaId);
		const passIndex = draft.lane.publications.findIndex((publication) => publication.mediaId === mediaId);
		if (!source || passIndex < 0) throw new ReferenceError(`Unknown take cycle capture media: ${mediaId}.`);
		const plan = capturePlan(draft);
		const pass = plan.passes[passIndex]!;
		const buffers = Array.from({ length: source.channelCount }, () => new Float32Array(source.chunkFrames));
		let bufferedFrames = 0;
		let writtenFrames = 0;
		for (let spanIndex = 0; spanIndex < draft.lane.captureSpans.length; spanIndex += 1) {
			throwIfAborted(signal);
			const span = draft.lane.captureSpans[spanIndex]!;
			if (span.endSample <= pass.captureStartSample || span.startSample >= pass.captureEndSample) continue;
			const chunk = await repository.chunk(record, spanIndex);
			const intersectionStart = Math.max(span.startSample, pass.captureStartSample);
			const intersectionEnd = Math.min(span.endSample, pass.captureEndSample);
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
		if (bufferedFrames) yield Object.freeze(buffers.map((channel) => channel.slice(0, bufferedFrames)));
		if (writtenFrames !== source.frameCount) throw new Error('Live capture pass is truncated.');
	}

	async function remove(draftValue: TakeCycleCaptureDraft): Promise<boolean> {
		const record = await repository.load(draftValue.projectId, draftValue.draftId);
		if (!record) return true;
		if (record.spoolToken !== draftValue.draftToken) return false;
		const draft = draftFromRecord(record);
		if (!sameDraft(draft, draftValue)) return false;
		return repository.remove(record);
	}

	async function materialize(
		record: RawPcmSpoolRecord,
		intentValue: LiveCaptureIntent,
		createPassIdentities: (passIndex: number, firstLaneId: string) => TakeCycleCapturePassIdentities,
		signal?: AbortSignal,
	): Promise<TakeCycleCaptureDraft> {
		const intent = normalizeIntent(intentValue, record);
		const capturedFrames = record.frameCount;
		const loopFrames = intent.loopEndSample - intent.loopStartSample;
		const passCount = Math.ceil(capturedFrames / loopFrames);
		if (passCount < 1 || passCount > TAKE_CYCLE_CAPTURE_MAXIMUM_PASSES) {
			throw new RangeError(`Cycle capture exceeds ${String(TAKE_CYCLE_CAPTURE_MAXIMUM_PASSES)} passes.`);
		}
		const identities = Array.from(
			{ length: passCount },
			(_, passIndex) => normalizePassIdentities(createPassIdentities(passIndex, intent.laneId)),
		);
		const plan = planExactTakeCycleCapture({
			groupId: intent.groupId,
			laneId: intent.laneId,
			laneIds: identities.map(({ laneId }) => laneId),
			loopStartSample: intent.loopStartSample,
			loopEndSample: intent.loopEndSample,
			captureSpans: intent.captureSpans,
			takeIds: identities.map(({ takeId }) => takeId),
			interrupted: capturedFrames % loopFrames !== 0,
		});
		const evidence = await collectTakeCycleLivePassEvidence({
			chunks: repository.chunks(record),
			captureSpans: intent.captureSpans,
			loopStartSample: intent.loopStartSample,
			loopEndSample: intent.loopEndSample,
			passCount,
			channelCount: intent.source.channelCount,
			chunkFrames: intent.source.chunkFrames,
			...(signal ? { signal } : {}),
		});
		const publications = plan.passes.map((_pass, index) => Object.freeze({
			...identities[index]!, ...evidence[index]!,
		}));
		const persistent = Object.freeze({
			version: 1 as const,
			draftId: intent.envelopeId,
			projectId: intent.projectId,
			publicationGeneration: intent.publicationGeneration,
			lane: Object.freeze({
				envelopeId: intent.envelopeId,
				groupId: intent.groupId,
				laneId: intent.laneId,
				loopStartSample: intent.loopStartSample,
				loopEndSample: intent.loopEndSample,
				captureSpans: intent.captureSpans,
				interrupted: plan.interrupted,
				publications: Object.freeze(publications),
			}),
			target: intent.target,
			sources: Object.freeze(plan.passes.map((pass, index) => Object.freeze({
				mediaId: publications[index]!.mediaId,
				...intent.source,
				frameCount: pass.captureEndSample - pass.captureStartSample,
			}))),
		});
		const next = await repository.replaceData(record, Object.freeze({ kind: DRAFT_KIND, draft: persistent }));
		return normalizeDraft(persistent, next.spoolToken);
	}

	async function ownedRecord(draft: TakeCycleCaptureDraft): Promise<RawPcmSpoolRecord> {
		const record = await repository.load(draft.projectId, draft.draftId);
		if (!record || record.spoolToken !== draft.draftToken) throw new Error('Live capture draft ownership changed.');
		return record;
	}

	function draftFromRecord(record: RawPcmSpoolRecord): TakeCycleCaptureDraft {
		if (record.state !== 'sealed') throw new Error('Live capture draft is not sealed.');
		const data = dataRecord(record.data, 'take cycle live capture draft data');
		if (data.kind !== DRAFT_KIND) throw new Error('Live capture spool has no finalization draft.');
		const draft = normalizeDraft(data.draft, record.spoolToken);
		if (draft.projectId !== record.projectId || draft.draftId !== record.spoolId
			|| draft.lane.captureSpans.length !== record.chunkCount
			|| draft.lane.captureSpans.at(-1)!.endSample - draft.lane.loopStartSample !== record.frameCount) {
			throw new Error('Live capture draft does not match its durable PCM prefix.');
		}
		return draft;
	}

}

interface NormalizedSeed extends TakeCycleLiveCaptureSeed {
	readonly target: TakeCycleLaneTarget;
	readonly source: Omit<TakeCycleSourceDescription, 'frameCount'>;
}

function normalizeSeed(value: TakeCycleLiveCaptureSeed): NormalizedSeed {
	const loopStartSample = nonNegativeInteger(value.loopStartSample, 'take cycle loopStartSample');
	const loopEndSample = nonNegativeInteger(value.loopEndSample, 'take cycle loopEndSample');
	if (loopEndSample <= loopStartSample) throw new RangeError('Take cycle loop extent must be positive.');
	const source = normalizeSource(value.source);
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
		target: normalizeTarget(value.target),
		source,
	});
}

function intentFromSeed(seed: NormalizedSeed): LiveCaptureIntent {
	if (seed.draftId !== seed.envelopeId) throw new Error('Live capture draft and envelope IDs must match.');
	return Object.freeze({
		kind: INTENT_KIND,
		projectId: seed.projectId,
		publicationGeneration: seed.publicationGeneration,
		envelopeId: seed.envelopeId,
		groupId: seed.groupId,
		laneId: seed.laneId,
		loopStartSample: seed.loopStartSample,
		loopEndSample: seed.loopEndSample,
		target: seed.target,
		source: seed.source,
		captureSpans: Object.freeze([]),
	});
}

function normalizeIntent(value: unknown, record: RawPcmSpoolRecord): LiveCaptureIntent {
	const intent = dataRecord(value, 'take cycle live capture intent');
	if (intent.kind !== INTENT_KIND) throw new Error('Take cycle live capture intent kind is invalid.');
	const captureSpans = denseArray(intent.captureSpans, TAKE_CYCLE_CAPTURE_MAXIMUM_SPANS).map((value) => {
		const span = dataRecord(value, 'take cycle live capture span');
		return Object.freeze({
			startSample: nonNegativeInteger(span.startSample, 'take cycle span startSample'),
			endSample: nonNegativeInteger(span.endSample, 'take cycle span endSample'),
		});
	});
	const normalized = Object.freeze({
		kind: INTENT_KIND,
		projectId: stableId(intent.projectId, 'take cycle projectId'),
		publicationGeneration: positiveInteger(intent.publicationGeneration, 'take cycle publicationGeneration'),
		envelopeId: stableId(intent.envelopeId, 'take cycle envelopeId'),
		groupId: stableId(intent.groupId, 'take cycle groupId'),
		laneId: stableId(intent.laneId, 'take cycle laneId'),
		loopStartSample: nonNegativeInteger(intent.loopStartSample, 'take cycle loopStartSample'),
		loopEndSample: nonNegativeInteger(intent.loopEndSample, 'take cycle loopEndSample'),
		target: normalizeTarget(intent.target),
		source: normalizeSource(intent.source),
		captureSpans: Object.freeze(captureSpans),
	});
	if (normalized.projectId !== record.projectId || normalized.envelopeId !== record.spoolId
		|| normalized.source.sampleRate !== record.sampleRate
		|| normalized.source.channelCount !== record.channelCount
		|| normalized.source.chunkFrames !== record.chunkFrames
		|| normalized.captureSpans.length !== record.chunkCount
		|| (normalized.captureSpans.at(-1)?.endSample ?? normalized.loopStartSample) - normalized.loopStartSample
			!== record.frameCount) {
		throw new Error('Take cycle live capture intent does not match its durable PCM prefix.');
	}
	return normalized;
}

function snapshotSpan(
	value: TakeCycleCapturePcmSpan,
	expectedStart: number,
	source: Omit<TakeCycleSourceDescription, 'frameCount'>,
): TakeCycleCapturePcmSpan {
	const startSample = nonNegativeInteger(value?.startSample, 'take cycle span startSample');
	const endSample = nonNegativeInteger(value?.endSample, 'take cycle span endSample');
	const frames = endSample - startSample;
	if (startSample !== expectedStart || frames < 1 || frames > source.chunkFrames) {
		throw new RangeError('Take cycle capture spans must be bounded, positive, and contiguous.');
	}
	if (!Array.isArray(value.channels) || value.channels.length !== source.channelCount
		|| frames * source.channelCount * Float32Array.BYTES_PER_ELEMENT > TAKE_CYCLE_CAPTURE_MAXIMUM_CHUNK_BYTES
		|| value.channels.some((channel) => !(channel instanceof Float32Array) || channel.length !== frames)) {
		throw new Error('Take cycle capture PCM has noncanonical bounded geometry.');
	}
	return Object.freeze({
		startSample, endSample,
		channels: Object.freeze(value.channels.map((channel) => channel.slice())),
	});
}

function capturePlan(draft: TakeCycleCaptureDraft) {
	return planExactTakeCycleCapture({
		groupId: draft.lane.groupId,
		laneId: draft.lane.laneId,
		laneIds: draft.lane.publications.map(({ laneId }) => laneId),
		loopStartSample: draft.lane.loopStartSample,
		loopEndSample: draft.lane.loopEndSample,
		captureSpans: draft.lane.captureSpans,
		takeIds: draft.lane.publications.map(({ takeId }) => takeId),
		interrupted: draft.lane.interrupted,
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
	const target = dataRecord(value, 'take cycle lane target');
	return Object.freeze({
		trackId: stableId(target.trackId, 'take cycle trackId'),
		sequenceId: stableId(target.sequenceId, 'take cycle sequenceId'),
	});
}

function normalizeSource(value: unknown): Omit<TakeCycleSourceDescription, 'frameCount'> {
	const source = dataRecord(value, 'take cycle source description');
	const normalized = {
		name: stableName(source.name),
		sampleRate: boundedPositiveInteger(source.sampleRate, 768_000, 'take cycle sampleRate'),
		channelCount: boundedPositiveInteger(source.channelCount, 64, 'take cycle channelCount'),
		chunkFrames: boundedPositiveInteger(source.chunkFrames, WAVPACK_PCM_MAXIMUM_FRAMES, 'take cycle chunkFrames'),
	};
	if (normalized.channelCount * normalized.chunkFrames * Float32Array.BYTES_PER_ELEMENT
		> TAKE_CYCLE_CAPTURE_MAXIMUM_CHUNK_BYTES) {
		throw new RangeError('Take cycle capture PCM chunk exceeds its strict memory bound.');
	}
	return Object.freeze(normalized);
}

function dataRecord(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be a data record.`);
	return value as Readonly<Record<string, unknown>>;
}

function denseArray(value: unknown, maximum: number): readonly unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
		|| value.length > maximum || Reflect.ownKeys(value).length !== value.length + 1) {
		throw new TypeError('Take cycle capture arrays must be bounded, standard, and dense.');
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
		throw new RangeError(`${name} must be a supported positive integer.`);
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

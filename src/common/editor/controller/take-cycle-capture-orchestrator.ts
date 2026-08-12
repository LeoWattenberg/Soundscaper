/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	TakeCycleEnvelopeRecoveryPlan,
	TakeCycleRecoveryEnvelope,
} from '../take-cycle-recovery-envelope.ts';
import type { TakeMediaPublicationBinding, TakeMediaRecoveryDecision } from '../take-media-recovery-journal.ts';
import {
	type TakeCycleCaptureDraft,
	type TakeCycleCapturePcmSpan,
	type TakeCycleCommittedCaptureSpool,
	type TakeCycleCaptureSpool,
} from './take-cycle-capture-spool.ts';
import type {
	TakeCycleLaneTarget,
	TakeCycleSourceDescription,
} from './take-cycle-recording-repository-composition.ts';
import {
	beginTakeCycleLiveCaptureSession,
	type BeginTakeCycleLiveSessionRequest,
	type TakeCycleLiveCaptureSession,
} from './take-cycle-live-capture-session.ts';
import { deriveTakeCycleOpenRecoveryAuthority } from './take-cycle-open-recovery-authority.ts';
import type {
	TakeCycleFinalizationResult,
	TakeCycleLaneFinalizationResult,
	TakeCycleRecordingOptions,
	TakeCycleRecordingService,
} from './take-cycle-recording-service.ts';

export type TakeCycleCapturedSpan = TakeCycleCapturePcmSpan;

export interface TakeCycleCapturedLane {
	readonly groupId: string;
	readonly trackId: string;
	readonly sequenceId: string;
	readonly name: string;
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly chunkFrames: number;
	readonly capture: Readonly<
		| { readonly kind: 'stream'; readonly spans: AsyncIterable<TakeCycleCapturedSpan> }
		| { readonly kind: 'committed'; readonly spool: TakeCycleCommittedCaptureSpool }
	>;
}

export interface FinalizeTakeCycleCaptureRequest {
	readonly projectId: string;
	readonly loopStartSample: number;
	readonly loopEndSample: number;
	readonly lanes: readonly TakeCycleCapturedLane[];
}

export interface RecoverTakeCycleOnOpenRequest {
	readonly pending: TakeCyclePendingOpenRecovery;
	readonly decision: TakeMediaRecoveryDecision;
}

export interface InspectTakeCycleOpenRecoveryRequest {
	readonly projectId: string;
}

export interface TakeCyclePendingOpenRecovery {
	readonly kind: 'take-cycle-pending-open-recovery';
	readonly projectId: string;
	readonly publicationGeneration: number;
	readonly recoveryToken: string;
	readonly draftCount: number;
	readonly requiresDecision: boolean;
}

export interface TakeCycleActivatedMedia {
	readonly laneId: string;
	readonly takeId: string;
	readonly mediaId: string;
}

export interface TakeCycleOpenRecoveryResult {
	readonly plan: TakeCycleEnvelopeRecoveryPlan;
	readonly activatedMedia: readonly TakeCycleActivatedMedia[];
	readonly resumedLanes: readonly TakeCycleLaneFinalizationResult[];
}

export interface TakeCycleCaptureOrchestratorDependencies {
	readonly service: Pick<TakeCycleRecordingService, 'finalize' | 'recover' | 'cancel'>;
	readonly spool: TakeCycleCaptureSpool;
	loadRecoveryEnvelope(projectId: string): PromiseLike<TakeCycleRecoveryEnvelope | null>
		| TakeCycleRecoveryEnvelope | null;
	createId(prefix: 'envelope' | 'lane' | 'take' | 'media' | 'journal'): string;
	activateCommittedSource(media: TakeCycleActivatedMedia): PromiseLike<void> | void;
	listRecoveredMedia(projectId: string): PromiseLike<readonly TakeMediaPublicationBinding[]>
		| readonly TakeMediaPublicationBinding[];
}

export interface TakeCycleCaptureOrchestrator {
	createCaptureSpoolId(): string;
	beginLiveSession(request: BeginTakeCycleLiveSessionRequest): Promise<TakeCycleLiveCaptureSession>;
	finalize(request: FinalizeTakeCycleCaptureRequest, options?: TakeCycleRecordingOptions): Promise<TakeCycleFinalizationResult>;
	recoverOnOpen(request: RecoverTakeCycleOnOpenRequest, options?: TakeCycleRecordingOptions): Promise<TakeCycleOpenRecoveryResult>;
	inspectOpenRecovery(request: InspectTakeCycleOpenRecoveryRequest): Promise<TakeCyclePendingOpenRecovery | null>;
	resolveLaneTarget(laneId: string): TakeCycleLaneTarget;
	describeSource(mediaId: string): TakeCycleSourceDescription;
	readPassChunks(mediaId: string, options?: TakeCycleRecordingOptions): AsyncIterable<readonly Float32Array[]>;
	readonly pendingCaptureCount: number;
	cancel(reason?: unknown): void;
}

interface ActiveSource {
	readonly draft: TakeCycleCaptureDraft;
	readonly description: TakeCycleSourceDescription;
}

/** Spool routed PCM durably, then drive exact lane finalization and open recovery. */
export function createTakeCycleCaptureOrchestrator(
	dependencies: TakeCycleCaptureOrchestratorDependencies,
): Readonly<TakeCycleCaptureOrchestrator> {
	const drafts = new Map<string, TakeCycleCaptureDraft>();
	const laneTargets = new Map<string, Readonly<{ draftId: string; target: TakeCycleLaneTarget }>>();
	const sourceDescriptions = new Map<string, ActiveSource>();
	return Object.freeze({
		createCaptureSpoolId,
		beginLiveSession,
		finalize,
		inspectOpenRecovery,
		recoverOnOpen,
		resolveLaneTarget,
		describeSource,
		readPassChunks,
		get pendingCaptureCount() { return drafts.size; },
		cancel: dependencies.service.cancel,
	});

	function createCaptureSpoolId(): string {
		return stableId(dependencies.createId('envelope'), 'take cycle capture spool ID');
	}

	function beginLiveSession(request: BeginTakeCycleLiveSessionRequest): Promise<TakeCycleLiveCaptureSession> {
		return beginTakeCycleLiveCaptureSession(request, {
			spool: dependencies.spool,
			createId: dependencies.createId,
			onDraft: indexDraft,
			finalizeDrafts,
		});
	}

	async function finalize(
		requestValue: FinalizeTakeCycleCaptureRequest,
		options: TakeCycleRecordingOptions = {},
	): Promise<TakeCycleFinalizationResult> {
		const request = normalizeFinalizationRequest(requestValue);
		const publicationGeneration = await dependencies.spool.allocateGeneration(request.projectId);
		const identities = new Set<string>();
		for (const lane of request.lanes) {
			if (!identities.has(lane.groupId)) identities.add(lane.groupId);
		}
		const prepared: TakeCycleCaptureDraft[] = [];
		try {
			for (const lane of request.lanes) {
				const envelopeId = freshIdentity(
					lane.capture.kind === 'committed'
						? lane.capture.spool.draftId
						: createCaptureSpoolId(),
					'envelope',
					identities,
				);
				const laneId = freshIdentity(dependencies.createId('lane'), 'lane', identities);
				const draft = await dependencies.spool.persist({
					draftId: envelopeId,
					projectId: request.projectId,
					publicationGeneration,
					envelopeId,
					groupId: lane.groupId,
					laneId,
					loopStartSample: request.loopStartSample,
					loopEndSample: request.loopEndSample,
					target: Object.freeze({ trackId: lane.trackId, sequenceId: lane.sequenceId }),
					source: Object.freeze({
						name: lane.name,
						sampleRate: lane.sampleRate,
						channelCount: lane.channelCount,
						chunkFrames: lane.chunkFrames,
					}),
					capture: lane.capture,
					createPassIdentities: () => Object.freeze({
						takeId: freshIdentity(dependencies.createId('take'), 'take', identities),
						mediaId: freshIdentity(dependencies.createId('media'), 'media', identities),
						journalId: freshIdentity(dependencies.createId('journal'), 'journal', identities),
					}),
				}, options.signal ? { signal: options.signal } : {});
				indexDraft(draft);
				prepared.push(draft);
			}
		} catch (error) {
			await discardPreparedDrafts(prepared, error);
		}
		return finalizeDrafts(prepared, publicationGeneration, options);
	}

	async function finalizeDrafts(
		prepared: readonly TakeCycleCaptureDraft[],
		publicationGeneration: number,
		options: TakeCycleRecordingOptions,
	): Promise<TakeCycleFinalizationResult> {
		if (!prepared.length || prepared.some((draft) => draft.publicationGeneration !== publicationGeneration)) {
			throw new Error('Prepared take cycle lanes do not share their exact publication generation.');
		}
		const laneResults: TakeCycleLaneFinalizationResult[] = [];
		for (const draft of prepared) {
			const result = await dependencies.service.finalize({
				publicationGeneration: draft.publicationGeneration,
				lanes: [draft.lane],
			}, options);
			const lane = result.lanes[0];
			if (!lane) throw new Error('Take cycle recording service returned no lane result.');
			await settleDraft(draft, lane);
			laneResults.push(lane);
		}
		return Object.freeze({
			kind: 'take-cycle-finalization',
			generation: publicationGeneration,
			lanes: Object.freeze(laneResults),
		});
	}

	async function recoverOnOpen(
		requestValue: RecoverTakeCycleOnOpenRequest,
		options: TakeCycleRecordingOptions = {},
	): Promise<TakeCycleOpenRecoveryResult> {
		const request = normalizeRecoveryRequest(requestValue);
		const pending = await inspectOpenRecovery({ projectId: request.projectId });
		if (!pending || pending.publicationGeneration !== request.publicationGeneration
			|| pending.recoveryToken !== request.recoveryToken) {
			throw new Error('Take cycle open recovery authority is stale.');
		}
		const inventory = await dependencies.spool.inspect(request.projectId);
		for (const draft of inventory.drafts) indexDraft(draft);
		const recoveryIdentities = new Set<string>();
		for (const draft of inventory.drafts) registerDraftIdentities(draft, recoveryIdentities);
		const resolved = await dependencies.spool.resolveOpenCaptures(
			request.projectId,
			request.decision,
			() => Object.freeze({
				takeId: freshIdentity(dependencies.createId('take'), 'take', recoveryIdentities),
				mediaId: freshIdentity(dependencies.createId('media'), 'media', recoveryIdentities),
				journalId: freshIdentity(dependencies.createId('journal'), 'journal', recoveryIdentities),
			}),
		);
		for (const draft of resolved) indexDraft(draft);
		for (const draft of await dependencies.spool.list(request.projectId)) indexDraft(draft);
		const plan = await dependencies.service.recover({
			currentGeneration: request.publicationGeneration,
			decision: request.decision,
		}, options);
		const activated: TakeCycleActivatedMedia[] = [];
		const activatedKeys = new Set<string>();
		const bindings = request.decision === 'recover'
			? await dependencies.listRecoveredMedia(request.projectId)
			: [];
		if (request.decision === 'recover'
			&& (plan.disposition === 'replay-published' || plan.disposition === 'settle-committed')) {
			for (const binding of bindings) await activate(binding, activated, activatedKeys);
		}
		const resumed: TakeCycleLaneFinalizationResult[] = [];
		for (const draft of [...drafts.values()]) {
			if (draft.projectId !== request.projectId) continue;
			if (request.decision === 'discard' || draft.publicationGeneration !== request.publicationGeneration) {
				await removeDraft(draft);
				continue;
			}
			const matching = exactDraftBindings(draft, bindings);
			if (matching.length === draft.lane.publications.length) {
				for (const binding of matching) await activate(binding, activated, activatedKeys);
				await removeDraft(draft);
				continue;
			}
			if (matching.length) throw new Error('Recovered take cycle media only partially matches its durable capture draft.');
			const result = await dependencies.service.finalize({
				publicationGeneration: draft.publicationGeneration,
				lanes: [draft.lane],
			}, options);
			const lane = result.lanes[0];
			if (!lane) throw new Error('Take cycle recovery resume returned no lane result.');
			for (const binding of lane.committedPasses) await activate(binding, activated, activatedKeys);
			await removeDraft(draft);
			resumed.push(lane);
		}
		return Object.freeze({
			plan,
			activatedMedia: Object.freeze(activated),
			resumedLanes: Object.freeze(resumed),
		});
	}

	async function inspectOpenRecovery(
		requestValue: InspectTakeCycleOpenRecoveryRequest,
	): Promise<TakeCyclePendingOpenRecovery | null> {
		const projectId = stableId(requestValue.projectId, 'take cycle projectId');
		const inventory = await dependencies.spool.inspect(projectId);
		for (const draft of inventory.drafts) indexDraft(draft);
		const envelope = await dependencies.loadRecoveryEnvelope(projectId);
		const authority = deriveTakeCycleOpenRecoveryAuthority({
			projectId, envelope, drafts: inventory.drafts, capturing: inventory.capturing,
		});
		if (!authority) return null;
		return Object.freeze({
			kind: 'take-cycle-pending-open-recovery',
			projectId,
			publicationGeneration: authority.publicationGeneration,
			recoveryToken: authority.recoveryToken,
			draftCount: inventory.drafts.length + inventory.capturingCount,
			requiresDecision: true,
		});
	}

	function resolveLaneTarget(laneIdValue: string): TakeCycleLaneTarget {
		const laneId = stableId(laneIdValue, 'take cycle laneId');
		const entry = laneTargets.get(laneId);
		if (!entry) throw new ReferenceError(`Unknown take cycle capture lane: ${laneId}.`);
		return entry.target;
	}

	function describeSource(mediaIdValue: string): TakeCycleSourceDescription {
		const mediaId = stableId(mediaIdValue, 'take cycle mediaId');
		const source = sourceDescriptions.get(mediaId);
		if (!source) throw new ReferenceError(`Unknown take cycle capture media: ${mediaId}.`);
		return source.description;
	}

	function readPassChunks(
		mediaIdValue: string,
		options: TakeCycleRecordingOptions = {},
	): AsyncIterable<readonly Float32Array[]> {
		const mediaId = stableId(mediaIdValue, 'take cycle mediaId');
		const source = sourceDescriptions.get(mediaId);
		if (!source) throw new ReferenceError(`Unknown take cycle capture media: ${mediaId}.`);
		return dependencies.spool.readPass(
			source.draft,
			mediaId,
			options.signal ? { signal: options.signal } : {},
		);
	}

	function indexDraft(draft: TakeCycleCaptureDraft): void {
		const existing = drafts.get(draft.draftId);
		if (existing && existing.draftToken !== draft.draftToken) {
			throw new Error(`Take cycle draft ${draft.draftId} changed durable ownership.`);
		}
		const lane = laneTargets.get(draft.lane.laneId);
		if (lane && lane.draftId !== draft.draftId) throw new Error('Take cycle lane identity is reused by another draft.');
		drafts.set(draft.draftId, draft);
		laneTargets.set(draft.lane.laneId, Object.freeze({ draftId: draft.draftId, target: draft.target }));
		for (const source of draft.sources) {
			const owned = sourceDescriptions.get(source.mediaId);
			if (owned && owned.draft.draftId !== draft.draftId) throw new Error('Take cycle media identity is reused by another draft.');
			sourceDescriptions.set(source.mediaId, Object.freeze({ draft, description: source }));
		}
	}

	async function settleDraft(draft: TakeCycleCaptureDraft, lane: TakeCycleLaneFinalizationResult): Promise<void> {
		for (const binding of lane.committedPasses) {
			await dependencies.activateCommittedSource(activatedMedia(binding));
		}
		await removeDraft(draft);
	}

	async function removeDraft(draft: TakeCycleCaptureDraft): Promise<void> {
		if (!await dependencies.spool.remove(draft)) {
			throw new Error(`Take cycle capture draft ${draft.draftId} changed before exact removal.`);
		}
		drafts.delete(draft.draftId);
		laneTargets.delete(draft.lane.laneId);
		for (const source of draft.sources) sourceDescriptions.delete(source.mediaId);
	}

	async function discardPreparedDrafts(prepared: readonly TakeCycleCaptureDraft[], primary: unknown): Promise<never> {
		const failures: unknown[] = [primary];
		for (const draft of prepared) {
			try { await removeDraft(draft); } catch (error) { failures.push(error); }
		}
		if (failures.length > 1) {
			throw new AggregateError(failures, 'Take cycle capture preparation and draft cleanup both failed.');
		}
		throw primary;
	}

	async function activate(
		binding: TakeMediaPublicationBinding,
		activated: TakeCycleActivatedMedia[],
		keys: Set<string>,
	): Promise<void> {
		const media = activatedMedia(binding);
		const key = `${media.laneId}\u0000${media.takeId}\u0000${media.mediaId}`;
		if (keys.has(key)) return;
		await dependencies.activateCommittedSource(media);
		keys.add(key);
		activated.push(media);
	}
}

interface NormalizedFinalizationRequest extends Omit<FinalizeTakeCycleCaptureRequest, 'lanes'> {
	readonly lanes: readonly TakeCycleCapturedLane[];
}

function normalizeFinalizationRequest(value: FinalizeTakeCycleCaptureRequest): NormalizedFinalizationRequest {
	const loopStartSample = nonNegativeInteger(value.loopStartSample, 'take cycle loopStartSample');
	const loopEndSample = nonNegativeInteger(value.loopEndSample, 'take cycle loopEndSample');
	if (loopEndSample <= loopStartSample) throw new RangeError('Take cycle loop extent must be positive.');
	const lanes = denseArray(value.lanes, 'take cycle captured lanes');
	if (!lanes.length) throw new RangeError('Take cycle capture requires at least one routed lane.');
	const normalizedLanes = lanes.map(normalizeLane);
	const groupTargets = new Map<string, string>();
	for (const lane of normalizedLanes) {
		const target = `${lane.sequenceId}\u0000${lane.trackId}`;
		const existing = groupTargets.get(lane.groupId);
		if (existing && existing !== target) {
			throw new Error(`Take cycle group ${lane.groupId} is routed to conflicting targets.`);
		}
		groupTargets.set(lane.groupId, target);
	}
	return Object.freeze({
		projectId: stableId(value.projectId, 'take cycle projectId'),
		loopStartSample,
		loopEndSample,
		lanes: Object.freeze(normalizedLanes),
	});
}

function normalizeLane(value: TakeCycleCapturedLane): TakeCycleCapturedLane {
	if (!value?.capture || (value.capture.kind !== 'stream' && value.capture.kind !== 'committed')
		|| (value.capture.kind === 'stream'
			&& (!value.capture.spans || typeof value.capture.spans[Symbol.asyncIterator] !== 'function'))) {
		throw new TypeError('Take cycle lane capture must be a stream or committed spool.');
	}
	return Object.freeze({
		groupId: stableId(value.groupId, 'take cycle groupId'),
		trackId: stableId(value.trackId, 'take cycle trackId'),
		sequenceId: stableId(value.sequenceId, 'take cycle sequenceId'),
		name: stableName(value.name),
		sampleRate: boundedPositiveInteger(value.sampleRate, 768_000, 'take cycle sampleRate'),
		channelCount: boundedPositiveInteger(value.channelCount, 64, 'take cycle channelCount'),
		chunkFrames: boundedPositiveInteger(value.chunkFrames, 65_536, 'take cycle chunkFrames'),
		capture: value.capture,
	});
}

function normalizeRecoveryRequest(value: RecoverTakeCycleOnOpenRequest): Readonly<{
	readonly projectId: string;
	readonly publicationGeneration: number;
	readonly recoveryToken: string;
	readonly decision: TakeMediaRecoveryDecision;
}> {
	if (value.decision !== 'recover' && value.decision !== 'discard') {
		throw new RangeError('Take cycle recovery decision must be recover or discard.');
	}
	const pending = value.pending;
	if (pending?.kind !== 'take-cycle-pending-open-recovery' || pending.requiresDecision !== true) {
		throw new TypeError('Take cycle recovery requires an exact pending authority.');
	}
	return Object.freeze({
		projectId: stableId(pending.projectId, 'take cycle projectId'),
		publicationGeneration: positiveInteger(pending.publicationGeneration, 'take cycle publicationGeneration'),
		recoveryToken: stableId(pending.recoveryToken, 'take cycle recovery token'),
		decision: value.decision,
	});
}

function exactDraftBindings(
	draft: TakeCycleCaptureDraft,
	bindings: readonly TakeMediaPublicationBinding[],
): readonly TakeMediaPublicationBinding[] {
	const matching: TakeMediaPublicationBinding[] = [];
	for (const publication of draft.lane.publications) {
		const binding = bindings.find((candidate) => candidate.mediaId === publication.mediaId);
		if (!binding) continue;
		if (binding.generation !== draft.publicationGeneration
			|| binding.groupId !== draft.lane.groupId
			|| binding.laneId !== draft.lane.laneId
			|| binding.takeId !== publication.takeId
			|| binding.byteLength !== publication.byteLength
			|| binding.sha256 !== publication.sha256) {
			throw new Error(`Recovered media ${binding.mediaId} conflicts with its capture draft.`);
		}
		matching.push(binding);
	}
	return Object.freeze(matching);
}

function registerDraftIdentities(draft: TakeCycleCaptureDraft, identities: Set<string>): void {
	const owned: Array<readonly [string, string]> = [
		[draft.draftId, 'envelope'],
		[draft.lane.laneId, 'lane'],
	];
	for (const publication of draft.lane.publications) {
		owned.push(
			[publication.takeId, 'take'],
			[publication.mediaId, 'media'],
			[publication.journalId, 'journal'],
		);
	}
	for (const [identity, kind] of owned) {
		freshIdentity(identity, kind, identities);
	}
}

function activatedMedia(binding: Pick<TakeMediaPublicationBinding, 'laneId' | 'takeId' | 'mediaId'>) {
	return Object.freeze({ laneId: binding.laneId, takeId: binding.takeId, mediaId: binding.mediaId });
}

function denseArray<Value>(value: readonly Value[], name: string): readonly Value[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
		|| value.length > 4_096 || Reflect.ownKeys(value).length !== value.length + 1) {
		throw new TypeError(`${name} must be a bounded standard dense data array.`);
	}
	return value;
}

function freshIdentity(value: string, kind: string, identities: Set<string>): string {
	const id = stableId(value, `take cycle ${kind} ID`);
	if (identities.has(id)) throw new RangeError(`Take cycle ${kind} ID ${id} is not globally fresh.`);
	identities.add(id);
	return id;
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

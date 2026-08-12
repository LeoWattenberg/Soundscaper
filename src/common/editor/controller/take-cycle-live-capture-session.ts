/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	TakeCycleCaptureDraft,
	TakeCycleCapturePcmSpan,
	TakeCycleCaptureSpool,
} from './take-cycle-capture-spool.ts';
import {
	normalizeTakeCycleLiveLaneRequest,
	type TakeCycleLiveLaneRequest,
} from './take-cycle-live-capture-request.ts';
import type {
	TakeCycleFinalizationResult,
	TakeCycleRecordingOptions,
} from './take-cycle-recording-service.ts';

export type TakeCycleLiveLaneDescription = TakeCycleLiveLaneRequest['lane'];
export type BeginTakeCycleLiveSessionRequest = Omit<
	TakeCycleLiveLaneRequest,
	'publicationGeneration' | 'lane'
>;

export interface TakeCycleLiveLaneCapture {
	readonly draftId: string;
	readonly spoolToken: string;
	readonly envelopeId: string;
	readonly laneId: string;
	readonly frameCount: number;
	append(span: TakeCycleCapturePcmSpan, options?: { readonly signal?: AbortSignal }): Promise<void>;
	seal(options?: { readonly signal?: AbortSignal }): Promise<TakeCycleCaptureDraft>;
	discard(): Promise<void>;
}

export interface TakeCycleLiveCaptureSession {
	readonly projectId: string;
	readonly publicationGeneration: number;
	readonly pendingLaneCount: number;
	beginLane(lane: TakeCycleLiveLaneDescription): Promise<TakeCycleLiveLaneCapture>;
	finalize(options?: TakeCycleRecordingOptions): Promise<TakeCycleFinalizationResult>;
}

export interface TakeCycleLiveCaptureSessionDependencies {
	readonly spool: Pick<TakeCycleCaptureSpool, 'allocateGeneration' | 'beginLive'>;
	createId(prefix: 'envelope' | 'lane' | 'take' | 'media' | 'journal'): string;
	onDraft(draft: TakeCycleCaptureDraft): void;
	finalizeDrafts(
		drafts: readonly TakeCycleCaptureDraft[],
		publicationGeneration: number,
		options: TakeCycleRecordingOptions,
	): Promise<TakeCycleFinalizationResult>;
}

/** One durable generation shared by every routed lane opened for a cycle capture. */
export async function beginTakeCycleLiveCaptureSession(
	requestValue: BeginTakeCycleLiveSessionRequest,
	dependencies: TakeCycleLiveCaptureSessionDependencies,
): Promise<Readonly<TakeCycleLiveCaptureSession>> {
	const request = normalizeSessionRequest(requestValue);
	const publicationGeneration = await dependencies.spool.allocateGeneration(request.projectId);
	const identities = new Set<string>();
	const groups = new Map<string, string>();
	const open = new Set<string>();
	const sealed: TakeCycleCaptureDraft[] = [];
	let finished = false;
	return Object.freeze({
		projectId: request.projectId,
		publicationGeneration,
		get pendingLaneCount() { return open.size + sealed.length; },
		beginLane,
		finalize,
	});

	async function beginLane(laneValue: TakeCycleLiveLaneDescription): Promise<TakeCycleLiveLaneCapture> {
		if (finished) throw new Error('Take cycle live capture session is already finalized.');
		const lane = normalizeTakeCycleLiveLaneRequest({ ...request, publicationGeneration, lane: laneValue });
		const targetKey = `${lane.lane.sequenceId}\u0000${lane.lane.trackId}`;
		const previousTarget = groups.get(lane.lane.groupId);
		if (previousTarget && previousTarget !== targetKey) {
			throw new Error(`Take cycle group ${lane.lane.groupId} is routed to conflicting targets.`);
		}
		if (!previousTarget) {
			freshIdentity(lane.lane.groupId, 'group', identities);
			groups.set(lane.lane.groupId, targetKey);
		}
		const envelopeId = freshIdentity(dependencies.createId('envelope'), 'envelope', identities);
		const laneId = freshIdentity(dependencies.createId('lane'), 'lane', identities);
		const writer = await dependencies.spool.beginLive({
			draftId: envelopeId,
			projectId: lane.projectId,
			publicationGeneration,
			envelopeId,
			groupId: lane.lane.groupId,
			laneId,
			loopStartSample: lane.loopStartSample,
			loopEndSample: lane.loopEndSample,
			target: Object.freeze({ trackId: lane.lane.trackId, sequenceId: lane.lane.sequenceId }),
			source: lane.lane,
			createPassIdentities: (passIndex, firstLaneId) => Object.freeze({
				laneId: passIndex === 0
					? firstLaneId
					: freshIdentity(dependencies.createId('lane'), 'lane', identities),
				takeId: freshIdentity(dependencies.createId('take'), 'take', identities),
				mediaId: freshIdentity(dependencies.createId('media'), 'media', identities),
				journalId: freshIdentity(dependencies.createId('journal'), 'journal', identities),
			}),
		});
		open.add(writer.draftId);
		return Object.freeze({
			draftId: writer.draftId,
			spoolToken: writer.spoolToken,
			envelopeId,
			laneId,
			get frameCount() { return writer.frameCount; },
			append: writer.append,
			async seal(options?: { readonly signal?: AbortSignal }) {
				const draft = await writer.seal(options);
				open.delete(writer.draftId);
				sealed.push(draft);
				dependencies.onDraft(draft);
				return draft;
			},
			async discard() {
				await writer.discard();
				open.delete(writer.draftId);
			},
		});
	}

	async function finalize(options: TakeCycleRecordingOptions = {}): Promise<TakeCycleFinalizationResult> {
		if (finished) throw new Error('Take cycle live capture session is already finalized.');
		if (open.size) throw new Error('Every take cycle live lane must be sealed before finalization.');
		if (!sealed.length) throw new RangeError('Take cycle live capture session has no sealed lanes.');
		finished = true;
		return dependencies.finalizeDrafts(Object.freeze([...sealed]), publicationGeneration, options);
	}
}

function normalizeSessionRequest(value: BeginTakeCycleLiveSessionRequest): BeginTakeCycleLiveSessionRequest {
	const loopStartSample = nonNegativeInteger(value.loopStartSample, 'take cycle loopStartSample');
	const loopEndSample = nonNegativeInteger(value.loopEndSample, 'take cycle loopEndSample');
	if (loopEndSample <= loopStartSample) throw new RangeError('Take cycle loop extent must be positive.');
	return Object.freeze({
		projectId: stableId(value.projectId, 'take cycle projectId'),
		loopStartSample,
		loopEndSample,
	});
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

function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be non-negative.`);
	return Number(value);
}

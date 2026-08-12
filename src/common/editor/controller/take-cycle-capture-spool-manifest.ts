/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	TAKE_CYCLE_CAPTURE_MAXIMUM_PASSES,
	TAKE_CYCLE_CAPTURE_MAXIMUM_SPANS,
	planExactTakeCycleCapture,
} from '../take-cycle-capture-domain.ts';
import type { StorageRecord } from '../storage/media-records.ts';
import type {
	TakeCycleCaptureDraft,
	TakeCycleCaptureDraftSource,
} from './take-cycle-capture-spool.ts';
import type { TakeCycleLaneFinalizationRequest } from './take-cycle-recording-service.ts';

const DRAFT_VERSION = 1 as const;
const DRAFT_MARKER = 'take-cycle-capture-draft-v1';

export function normalizeStoredDraft(record: StorageRecord): TakeCycleCaptureDraft {
	if (record.takeCycleCaptureDraftVersion !== DRAFT_VERSION || typeof record.sourceToken !== 'string') {
		throw new Error('Take cycle capture draft metadata is unavailable.');
	}
	const draft = normalizeDraft(record.takeCycleCaptureDraft, record.sourceToken);
	const captureFrames = draft.lane.captureSpans.at(-1)!.endSample - draft.lane.loopStartSample;
	const source = draft.sources[0]!;
	if (record.id !== draft.draftId || record.type !== DRAFT_MARKER
		|| Number(record.frameCount ?? record.frameLength) !== captureFrames
		|| Number(record.sampleRate) !== source.sampleRate
		|| Number(record.channelCount) !== source.channelCount
		|| Number(record.chunkFrames) !== source.chunkFrames) {
		throw new Error('Take cycle capture draft storage geometry changed.');
	}
	return draft;
}

export function capturePlan(lane: TakeCycleLaneFinalizationRequest) {
	return planExactTakeCycleCapture({
		groupId: lane.groupId,
		laneId: lane.laneId,
		loopStartSample: lane.loopStartSample,
		loopEndSample: lane.loopEndSample,
		captureSpans: lane.captureSpans,
		takeIds: lane.publications.map(({ takeId }) => takeId),
		interrupted: lane.interrupted,
	});
}

export function sameDraft(left: TakeCycleCaptureDraft, right: TakeCycleCaptureDraft): boolean {
	const { draftToken: _leftToken, ...leftPersistent } = left;
	const { draftToken: _rightToken, ...rightPersistent } = right;
	return left.draftToken === right.draftToken
		&& JSON.stringify(leftPersistent) === JSON.stringify(rightPersistent);
}

export function normalizeDraft(value: unknown, draftTokenValue: unknown): TakeCycleCaptureDraft {
	const record = dataRecord(value, 'take cycle capture draft');
	const laneRecord = dataRecord(record.lane, 'take cycle capture draft lane');
	const captureSpans = denseArray(laneRecord.captureSpans, TAKE_CYCLE_CAPTURE_MAXIMUM_SPANS).map((value) => {
		const span = dataRecord(value, 'take cycle capture draft span');
		return Object.freeze({
			startSample: nonNegativeInteger(span.startSample, 'take cycle span startSample'),
			endSample: nonNegativeInteger(span.endSample, 'take cycle span endSample'),
		});
	});
	const publicationValues = denseArray(laneRecord.publications, TAKE_CYCLE_CAPTURE_MAXIMUM_PASSES);
	const plan = planExactTakeCycleCapture({
		groupId: laneRecord.groupId,
		laneId: laneRecord.laneId,
		loopStartSample: laneRecord.loopStartSample,
		loopEndSample: laneRecord.loopEndSample,
		captureSpans,
		takeIds: publicationValues.map((value) => stableId(
			dataRecord(value, 'take cycle publication').takeId,
			'take cycle takeId',
		)),
		interrupted: laneRecord.interrupted,
	});
	const publications = publicationValues.map((value, index) => {
		const publication = dataRecord(value, 'take cycle publication');
		if (publication.takeId !== plan.passes[index]!.takeId) throw new Error('Take cycle take identity changed.');
		return Object.freeze({
			journalId: stableId(publication.journalId, 'take cycle journalId'),
			takeId: plan.passes[index]!.takeId,
			mediaId: stableId(publication.mediaId, 'take cycle mediaId'),
			byteLength: positiveInteger(publication.byteLength, 'take cycle publication byteLength'),
			sha256: sha256(publication.sha256),
		});
	});
	const sourceValues = denseArray(record.sources, TAKE_CYCLE_CAPTURE_MAXIMUM_PASSES);
	if (sourceValues.length !== publications.length) throw new Error('Take cycle source descriptions are incomplete.');
	const sources = sourceValues.map((value, index) => normalizeSource(value, publications[index]!.mediaId,
		plan.passes[index]!.captureEndSample - plan.passes[index]!.captureStartSample));
	return Object.freeze({
		version: DRAFT_VERSION,
		draftId: stableId(record.draftId, 'take cycle draftId'),
		draftToken: stableId(draftTokenValue, 'take cycle draft token'),
		projectId: stableId(record.projectId, 'take cycle projectId'),
		publicationGeneration: positiveInteger(record.publicationGeneration, 'take cycle publicationGeneration'),
		lane: Object.freeze({
			envelopeId: stableId(laneRecord.envelopeId, 'take cycle envelopeId'),
			groupId: plan.groupId,
			laneId: plan.laneId,
			loopStartSample: plan.loopStartSample,
			loopEndSample: plan.loopEndSample,
			captureSpans: Object.freeze(captureSpans),
			interrupted: plan.interrupted,
			publications: Object.freeze(publications),
		}),
		target: normalizeTarget(record.target),
		sources: Object.freeze(sources),
	});
}

function normalizeSource(value: unknown, mediaId: string, expectedFrames: number): TakeCycleCaptureDraftSource {
	const record = dataRecord(value, 'take cycle source description');
	const source = {
		mediaId: stableId(record.mediaId, 'take cycle source mediaId'),
		name: stableName(record.name),
		sampleRate: positiveInteger(record.sampleRate, 'take cycle sampleRate'),
		channelCount: positiveInteger(record.channelCount, 'take cycle channelCount'),
		chunkFrames: positiveInteger(record.chunkFrames, 'take cycle chunkFrames'),
		frameCount: positiveInteger(record.frameCount, 'take cycle frameCount'),
	};
	if (source.mediaId !== mediaId || source.frameCount !== expectedFrames) {
		throw new Error('Take cycle source description does not match its pass.');
	}
	return Object.freeze(source);
}

function normalizeTarget(value: unknown) {
	const record = dataRecord(value, 'take cycle lane target');
	return Object.freeze({
		trackId: stableId(record.trackId, 'take cycle trackId'),
		sequenceId: stableId(record.sequenceId, 'take cycle sequenceId'),
	});
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

function sha256(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) throw new TypeError('Take cycle SHA-256 is invalid.');
	return value;
}

function positiveInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) throw new RangeError(`${name} must be positive.`);
	return Number(value);
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be non-negative.`);
	return Number(value);
}

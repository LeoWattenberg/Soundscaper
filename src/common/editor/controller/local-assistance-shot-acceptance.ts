/* SPDX-License-Identifier: AGPL-3.0-only */

/** Transactional baseline marker acceptance for reviewed Fast and Accurate shot cuts. */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
	createAssistanceProposalSession,
	AssistanceProposalStaleError,
	validateAssistanceSelectionFence,
	type AssistanceSelectionFence,
} from '../assistance/proposal-session.ts';
import { MAX_SHOTS } from '../assistance/shots.ts';
import {
	LOCAL_ASSISTANCE_TRANSNET_V2_MODEL_ID,
	LOCAL_ASSISTANCE_TRANSNET_V2_MODEL_TASK,
	normalizeLocalAssistanceShotDetector,
	type LocalAssistanceShotDetector,
} from '../assistance/shot-detection-mode.ts';
import {
	createAddTimelineAnnotationCommand,
	createRemoveTimelineAnnotationsCommand,
} from '../commands/factories.ts';
import { sequenceFrameBoundarySample } from '../sequence-frame-navigation.ts';
import {
	AUDIO_EDITOR_TIMELINE_ANNOTATION_LIMITS,
	createTimelineAnnotationV11,
	type TimelineAnnotationV11,
} from '../timeline-annotation.ts';
import type { RationalRate } from '../timeline-time.ts';
import {
	VIDEO_TIMING_ASSET_MAXIMUM_FRAMES,
	VIDEO_TIMING_ASSET_MAXIMUM_TIMESCALE,
} from '../video-timing-asset-reference.ts';
import {
	FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
	PROJECT_SCHEMA_VERSION,
	readProjectSchemaIdentity,
} from '../project-schema-identity.ts';
import {
	mapLocalAssistanceSelectedVideoSourceBoundary,
	type LocalAssistanceSelectedVideoAuthority,
} from './local-assistance-selected-video.ts';

const EXTENSION_KEY = 'org.soundscaper.assistance-shot-boundaries-v1';
const SHA256 = /^[a-f\d]{64}$/u;
const OPAQUE_ID = /^[a-f\d]{40}$/u;
const MAXIMUM_OUTPUT_BYTES = 64 * 1024 * 1024;
const UTF8 = new TextEncoder();

type DataRecord = Readonly<Record<string, unknown>>;

export interface LocalAssistanceShotAcceptanceDependencies {
	readonly currentAuthority: () => LocalAssistanceSelectedVideoAuthority;
	readonly captureProject: () => unknown;
	readonly assertProject: (token: unknown) => void;
	readonly commit: (command: DataRecord) => void;
}

export interface LocalAssistanceShotAcceptance {
	acceptValidatedResult(request: unknown): Promise<void>;
}

interface ShotBoundary {
	readonly sourceFrame: number;
	readonly presentationTick: string;
	readonly score: number;
}

interface ShotReview {
	readonly detector: LocalAssistanceShotDetector;
	readonly timescale: number;
	readonly sourceFrameCount: number;
	readonly boundaries: readonly ShotBoundary[];
}

interface NormalizedAuthority {
	readonly fence: AssistanceSelectionFence;
	readonly sampleRate: number;
	readonly sequenceRate: RationalRate;
	readonly sequenceStartFrame: number;
	readonly sequenceEndFrame: number;
	readonly sourceStartFrame: number;
	readonly sourceEndFrame: number;
	readonly sourceFrameCount: number;
	readonly mapSourceBoundary: (sourceFrame: number) => number | null;
	readonly timelineAnnotations: readonly TimelineAnnotationV11[];
	readonly tempoMap: unknown;
}

interface NormalizedRequest {
	readonly fence: AssistanceSelectionFence;
	readonly review: ShotReview;
}

export function createLocalAssistanceShotAcceptance(
	dependencies: LocalAssistanceShotAcceptanceDependencies,
): Readonly<LocalAssistanceShotAcceptance> {
	assertDependencies(dependencies);
	return Object.freeze({
		async acceptValidatedResult(value: unknown): Promise<void> {
			const request = normalizeRequest(value);
			const initial = normalizeAuthority(dependencies.currentAuthority());
			assertSameFence(request.fence, initial.fence);
			const selectedRangeCount = request.review.detector === 'transnetv2'
				&& request.review.sourceFrameCount === initial.sourceEndFrame;
			if (request.review.sourceFrameCount !== initial.sourceFrameCount && !selectedRangeCount) {
				throw new RangeError('The reviewed shot source-frame count disagrees with its source authority.');
			}
			const ownership = ownershipExtension(request, initial);
			const existing = initial.timelineAnnotations.filter((annotation) => owned(annotation, ownership));
			const desired = createMarkers(request, initial, ownership);
			const unownedCount = initial.timelineAnnotations.length - existing.length;
			if (desired.length > AUDIO_EDITOR_TIMELINE_ANNOTATION_LIMITS.maximumAnnotations - unownedCount) {
				throw new RangeError('The reviewed shot markers exceed timeline annotation capacity.');
			}
			const unownedIds = new Set(initial.timelineAnnotations
				.filter((annotation) => !owned(annotation, ownership)).map(({ id }) => id));
			if (desired.some(({ id }) => unownedIds.has(id))) {
				throw new Error('A stable assistance shot marker identity is owned by another edit.');
			}
			const command = replacementCommand(existing, desired);
			if (command === null) return;
			const proposalId = 'shot-detection:markers';
			const session = createAssistanceProposalSession({
				operation: 'shot-detection', fence: request.fence,
				proposals: [Object.freeze({ id: proposalId, kind: 'shot-detection:markers', command })],
				currentFence: () => normalizeAuthority(dependencies.currentAuthority()).fence,
				commit: (batch) => {
					if (batch.commands.length !== 1 || !same(batch.commands[0], command)
						|| batch.assistanceAssets.length !== 0) {
						throw new Error('The accepted shot-marker proposal changed before commit.');
					}
					const token = dependencies.captureProject();
					const current = normalizeAuthority(dependencies.currentAuthority());
					assertSameFence(request.fence, current.fence);
					const currentOwned = current.timelineAnnotations.filter(
						(annotation) => owned(annotation, ownership),
					);
					if (!same(currentOwned, existing)) throw new AssistanceProposalStaleError();
					dependencies.assertProject(token);
					assertSameFence(request.fence,
						normalizeAuthority(dependencies.currentAuthority()).fence);
					dependencies.commit(command);
				},
				discardStaged: () => undefined,
			});
			await session.accept([proposalId]);
		},
	});
}

function createMarkers(
	request: NormalizedRequest,
	authority: NormalizedAuthority,
	ownership: DataRecord,
): readonly TimelineAnnotationV11[] {
	const digest = fenceDigest(request.fence);
	const batchId = `assistance-shot-batch:${digest}`;
	const inSelection = request.review.boundaries.flatMap((boundary) => {
		if (boundary.sourceFrame <= authority.sourceStartFrame
			|| boundary.sourceFrame >= authority.sourceEndFrame) return [];
		const sequenceFrame = authority.mapSourceBoundary(boundary.sourceFrame);
		return sequenceFrame !== null && sequenceFrame > authority.sequenceStartFrame
			&& sequenceFrame < authority.sequenceEndFrame
			? [Object.freeze({ boundary, sequenceFrame })] : [];
	});
	return Object.freeze(inSelection.map(({ boundary, sequenceFrame }, index) => {
		const positionFrame = sequenceFrameBoundarySample(
			sequenceFrame, authority.sequenceRate, authority.sampleRate,
		);
		return createTimelineAnnotationV11({
			id: `assistance-shot:${digest}:${String(boundary.sourceFrame)}`,
			sequenceId: request.fence.sequenceId,
			name: `Shot ${String(index + 1)}`,
			color: 'orange', batchId,
			opaqueExtensions: {
				[EXTENSION_KEY]: Object.freeze({
					...ownership,
					sourceFrame: boundary.sourceFrame,
					presentationTick: boundary.presentationTick,
					score: boundary.score,
				}),
			},
			kind: 'marker', anchor: 'sample', positionFrame,
		}, { sampleRate: authority.sampleRate, tempoMap: authority.tempoMap as never });
	}));
}

function replacementCommand(
	existing: readonly TimelineAnnotationV11[],
	desired: readonly TimelineAnnotationV11[],
): DataRecord | null {
	const commands: DataRecord[] = [];
	if (existing.length) commands.push(Object.freeze(createRemoveTimelineAnnotationsCommand(
		existing.map(({ id }) => id),
	)) as unknown as DataRecord);
	commands.push(...desired.map((annotation) => Object.freeze(
		createAddTimelineAnnotationCommand(annotation),
	) as unknown as DataRecord));
	return commands.length ? Object.freeze({ type: 'batch', commands: Object.freeze(commands) }) : null;
}

function normalizeRequest(value: unknown): NormalizedRequest {
	const request = exactRecord(value,
		['sourceId', 'operation', 'selectionFence', 'models', 'outputs'],
		'shot acceptance request');
	const fence = validateAssistanceSelectionFence(request.selectionFence);
	if (request.operation !== 'shot-detection' || request.sourceId !== fence.sourceId) {
		throw new TypeError('Shot acceptance requires the exact selected source and operation.');
	}
	if (!Array.isArray(request.outputs) || request.outputs.length !== 1) {
		throw new RangeError('Shot acceptance requires one reviewed output.');
	}
	const output = exactRecord(request.outputs[0], ['claim', 'review'], 'reviewed shot output');
	validateClaim(output.claim);
	const review = normalizeReview(output.review);
	normalizeModels(request.models, review.detector);
	return Object.freeze({ fence, review });
}

function normalizeReview(value: unknown): ShotReview {
	const review = exactRecord(value,
		['kind', 'schemaVersion', 'detector', 'timescale', 'sourceFrameCount', 'boundaries'],
		'shot review');
	if (review.kind !== 'shot-boundaries' || review.schemaVersion !== 1) {
		throw new TypeError('The reviewed shot result has an unsupported schema.');
	}
	const detector = normalizeLocalAssistanceShotDetector(review.detector);
	const timescale = boundedInteger(review.timescale, 1,
		VIDEO_TIMING_ASSET_MAXIMUM_TIMESCALE, 'shot timescale');
	const sourceFrameCount = boundedInteger(review.sourceFrameCount, 1,
		VIDEO_TIMING_ASSET_MAXIMUM_FRAMES, 'shot source-frame count');
	if (!Array.isArray(review.boundaries)
		|| review.boundaries.length > Math.min(MAX_SHOTS, sourceFrameCount)) {
		throw new RangeError('The reviewed shot result exceeds its boundary bound.');
	}
	let priorFrame = -1;
	let priorTick = -1n;
	const boundaries = review.boundaries.map((candidate, index) => {
		const boundary = exactRecord(candidate,
			['sourceFrame', 'presentationTick', 'score'], `shot boundary ${String(index)}`);
		const sourceFrame = integer(boundary.sourceFrame, 0, `shot boundary ${String(index)} frame`);
		if (sourceFrame >= sourceFrameCount || sourceFrame <= priorFrame) {
			throw new RangeError('Reviewed shot boundaries must be strictly ordered inside the source.');
		}
		if (typeof boundary.presentationTick !== 'string'
			|| !/^(?:0|[1-9]\d*)$/u.test(boundary.presentationTick)) {
			throw new TypeError('A reviewed shot presentation tick is invalid.');
		}
		const tick = BigInt(boundary.presentationTick);
		if (tick > 0x7fff_ffff_ffff_ffffn || tick <= priorTick) {
			throw new RangeError('Reviewed shot presentation ticks must be strictly increasing.');
		}
		if (typeof boundary.score !== 'number' || !Number.isFinite(boundary.score)
			|| boundary.score < 0 || boundary.score > 1) {
			throw new RangeError('A reviewed shot score is invalid.');
		}
		priorFrame = sourceFrame;
		priorTick = tick;
		return Object.freeze({ sourceFrame,
			presentationTick: boundary.presentationTick, score: boundary.score });
	});
	return Object.freeze({ detector, timescale, sourceFrameCount,
		boundaries: Object.freeze(boundaries) });
}

function normalizeModels(value: unknown, detector: LocalAssistanceShotDetector): void {
	if (!Array.isArray(value)) {
		throw new TypeError('Shot acceptance requires an exact model set.');
	}
	if (detector === 'ffmpeg-scdet') {
		if (value.length !== 0) {
			throw new RangeError('Fast shot detection acceptance must remain model-free.');
		}
		return;
	}
	if (value.length !== 1) {
		throw new RangeError('Accurate shot detection requires one exact TransNetV2 model binding.');
	}
	const model = exactRecord(value[0],
		['modelId', 'version', 'task', 'artifactSha256s'], 'TransNetV2 model binding');
	if (model.modelId !== LOCAL_ASSISTANCE_TRANSNET_V2_MODEL_ID
		|| model.task !== LOCAL_ASSISTANCE_TRANSNET_V2_MODEL_TASK
		|| typeof model.version !== 'string' || model.version.length < 1
		|| model.version.length > 160 || model.version.trim() !== model.version) {
		throw new TypeError('Accurate shot detection has an invalid TransNetV2 model identity or role.');
	}
	if (!Array.isArray(model.artifactSha256s) || model.artifactSha256s.length < 1
		|| model.artifactSha256s.length > 64
		|| model.artifactSha256s.some((candidate) => typeof candidate !== 'string'
			|| !SHA256.test(candidate))
		|| new Set(model.artifactSha256s).size !== model.artifactSha256s.length) {
		throw new TypeError('Accurate shot detection has invalid model artifact authority.');
	}
}

function validateClaim(value: unknown): void {
	const claim = exactRecord(value,
		['claimVersion', 'claimId', 'jobId', 'role', 'mediaType', 'byteLength', 'sha256'],
		'shot output claim');
	if (claim.claimVersion !== 1 || claim.role !== 'shot-boundaries'
		|| (claim.mediaType !== 'application/json'
			&& claim.mediaType !== 'application/vnd.soundscaper.shot-boundaries+json')
		|| typeof claim.claimId !== 'string' || !OPAQUE_ID.test(claim.claimId)
		|| typeof claim.jobId !== 'string' || !OPAQUE_ID.test(claim.jobId)
		|| !Number.isSafeInteger(claim.byteLength) || Number(claim.byteLength) < 1
		|| Number(claim.byteLength) > MAXIMUM_OUTPUT_BYTES
		|| typeof claim.sha256 !== 'string' || !SHA256.test(claim.sha256)) {
		throw new TypeError('The reviewed shot output claim is invalid.');
	}
}

function normalizeAuthority(value: LocalAssistanceSelectedVideoAuthority): NormalizedAuthority {
	if (!value || typeof value !== 'object') {
		throw new TypeError('Shot acceptance requires selected-video authority.');
	}
	const identity = readProjectSchemaIdentity(value.project);
	if (identity.schemaFamily !== FRAMESCAPER_PROJECT_SCHEMA_FAMILY
		|| identity.schemaVersion !== PROJECT_SCHEMA_VERSION) {
		throw new AssistanceProposalStaleError();
	}
	const project = dataRecord(value.project, 'shot project');
	const source = dataRecord(value.source, 'shot source');
	const clip = dataRecord(value.clip, 'shot clip');
	const sequence = dataRecord(value.sequence, 'shot sequence');
	const fence = validateAssistanceSelectionFence(value.fence);
	if (project.id !== fence.projectId || project.schemaFamily !== fence.schemaFamily
		|| project.schemaVersion !== fence.schemaVersion || project.revision !== fence.revision
		|| source.id !== fence.sourceId || clip.id !== fence.occurrenceIds[0]
		|| fence.occurrenceIds.length !== 1 || clip.sequenceId !== fence.sequenceId
		|| sequence.id !== fence.sequenceId || !Array.isArray(project.timelineAnnotations)) {
		throw new AssistanceProposalStaleError();
	}
	const sampleRate = integer(project.sampleRate, 1, 'project sample rate');
	const sequenceStartFrame = integer(clip.sequenceStartFrame, 0, 'clip sequence start');
	const sequenceFrameCount = integer(clip.sequenceFrameCount, 1, 'clip sequence count');
	const sequenceEndFrame = safeAdd(sequenceStartFrame, sequenceFrameCount, 'clip sequence end');
	const sourceStartFrame = integer(value.sourceStartFrame, 0, 'selected source start');
	const sourceEndFrame = integer(value.sourceEndFrame, 1, 'selected source end');
	const sourceInFrame = integer(clip.sourceInFrame, 0, 'clip source start');
	const sourceFrameCount = integer(source.sourceFrameCount, 1, 'source frame count');
	if (sourceStartFrame !== sourceInFrame || sourceStartFrame !== fence.sourceStartFrame
		|| sourceEndFrame !== safeAdd(sourceInFrame,
			integer(clip.sourceFrameCount, 1, 'clip source count'), 'clip source end')
		|| sourceEndFrame !== fence.sourceEndFrame
		|| sourceEndFrame > sourceFrameCount) throw new AssistanceProposalStaleError();
	let mappedStart: number | null;
	let mappedEnd: number | null;
	try {
		mappedStart = mapLocalAssistanceSelectedVideoSourceBoundary(value, sourceStartFrame);
		mappedEnd = mapLocalAssistanceSelectedVideoSourceBoundary(value, sourceEndFrame);
	} catch {
		throw new AssistanceProposalStaleError();
	}
	if (mappedStart !== sequenceStartFrame || mappedEnd !== sequenceEndFrame) {
		throw new AssistanceProposalStaleError();
	}
	const rate = dataRecord(sequence.rate, 'sequence rate');
	const sequenceRate = Object.freeze({
		num: integer(rate.num, 1, 'sequence rate numerator'),
		den: integer(rate.den, 1, 'sequence rate denominator'),
	});
	return Object.freeze({ fence, sampleRate, sequenceRate,
		sequenceStartFrame, sequenceEndFrame, sourceStartFrame, sourceEndFrame, sourceFrameCount,
		mapSourceBoundary: (sourceFrame: number): number | null => (
			mapLocalAssistanceSelectedVideoSourceBoundary(value, sourceFrame)
		),
		timelineAnnotations: Object.freeze(project.timelineAnnotations as TimelineAnnotationV11[]),
		tempoMap: project.tempoMap });
}

function ownershipExtension(
	request: NormalizedRequest,
	authority: NormalizedAuthority,
): DataRecord {
	return Object.freeze({
		schemaVersion: 1, operation: 'shot-detection', detector: request.review.detector,
		timescale: request.review.timescale, sourceFrameCount: request.review.sourceFrameCount,
		sourceId: request.fence.sourceId, sourceSha256: request.fence.sourceSha256,
		sourceStartFrame: authority.sourceStartFrame, sourceEndFrame: authority.sourceEndFrame,
		timingAuthoritySha256: request.fence.timingAuthoritySha256,
	});
}

function owned(annotation: TimelineAnnotationV11, ownership: DataRecord): boolean {
	const extensions = dataRecordOrNull(annotation.opaqueExtensions);
	const value = dataRecordOrNull(extensions?.[EXTENSION_KEY]);
	if (!value) return false;
	return Object.entries(ownership).every(([key, expected]) => same(value[key], expected));
}

function fenceDigest(fence: AssistanceSelectionFence): string {
	return bytesToHex(sha256(UTF8.encode(JSON.stringify(fence))));
}

function assertSameFence(left: AssistanceSelectionFence, right: AssistanceSelectionFence): void {
	if (!same(left, right)) throw new AssistanceProposalStaleError();
}

function dataRecord(value: unknown, label: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`The ${label} is invalid.`);
	}
	return value as DataRecord;
}

function dataRecordOrNull(value: unknown): DataRecord | null {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as DataRecord : null;
}

function exactRecord(value: unknown, fields: readonly string[], label: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError(`The ${label} must be a plain record.`);
	}
	const record = value as DataRecord;
	const keys = Reflect.ownKeys(record);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`The ${label} fields are invalid.`);
	}
	return record;
}

function integer(value: unknown, minimum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum) {
		throw new RangeError(`The ${label} is invalid.`);
	}
	return Number(value);
}

function boundedInteger(value: unknown, minimum: number, maximum: number, label: string): number {
	const result = integer(value, minimum, label);
	if (result > maximum) throw new RangeError(`The ${label} is invalid.`);
	return result;
}

function safeAdd(left: number, right: number, label: string): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw new RangeError(`The ${label} is invalid.`);
	return result;
}

function same(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function assertDependencies(value: LocalAssistanceShotAcceptanceDependencies): void {
	if (!value || typeof value !== 'object' || typeof value.currentAuthority !== 'function'
		|| typeof value.captureProject !== 'function' || typeof value.assertProject !== 'function'
		|| typeof value.commit !== 'function') {
		throw new TypeError('Shot acceptance requires exact controller ports.');
	}
}

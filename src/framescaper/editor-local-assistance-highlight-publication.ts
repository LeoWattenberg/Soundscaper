/* SPDX-License-Identifier: AGPL-3.0-only */

/** Strict review and atomic F31 publication of selected Milestone-7 highlights. */

import {
	validateAssistanceWorkflowFenceV1,
	type AssistanceWorkflowFenceV1,
	type AssistanceWorkflowSourceRangeV1,
} from '../common/editor/assistance/workflow.ts';
import { AssistanceProposalStaleError } from '../common/editor/assistance/proposal-session.ts';
import {
	createAddClipCommand,
	createAddTrackCommand,
	createSetVideoKeyframesCommand,
} from '../common/editor/commands/factories.ts';
import {
	createAudioClip,
	createAudioTrack,
	createLabel,
	createLabelTrack,
	createVideoTrack,
} from '../common/editor/project-media-factory.ts';
import {
	DEFAULT_VIDEO_CLIP_COMPOSITION,
} from '../common/editor/video-clip-composition.ts';
import {
	createDefaultVideoKeyframeCurves,
	normalizeVideoKeyframeCurves,
} from '../common/editor/video-keyframe-curves.ts';
import {
	sampleFrameToVideoFrame,
	videoFrameToSampleFrame,
	type RationalRate,
} from '../common/editor/timeline-time.ts';
import {
	applyFramescaperProjectCommandV31,
	type FramescaperProjectCommandV31,
} from './editor-project-v31-commands.ts';
import {
	FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE,
} from './editor-project-runtime-profile-v31.ts';
import {
	validateFramescaperProjectV31,
	type FramescaperProjectV31,
} from './editor-project-v31.ts';
import {
	reviewFramescaperAssistanceHighlightsV1,
	type FramescaperAssistanceHighlightProposalV1,
} from './editor-local-assistance-highlight-review.ts';

type Awaitable<Value> = PromiseLike<Value> | Value;
type DataRecord = Readonly<Record<string, unknown>>;

export interface FramescaperAssistanceHighlightAuthority {
	readonly project: FramescaperProjectV31;
	readonly fence: AssistanceWorkflowFenceV1;
}

export interface FramescaperAssistanceHighlightPublicationDependencies {
	readonly currentAuthority: () => FramescaperAssistanceHighlightAuthority;
	readonly captureProject: () => unknown;
	readonly assertProject: (token: unknown) => void;
	readonly createId: (prefix: string) => string;
	readonly commit: (command: FramescaperProjectCommandV31) => Awaitable<void>;
}

export interface FramescaperAssistanceHighlightPublication {
	acceptReviewed(value: unknown, selectedProposalIds?: readonly string[]): Promise<void>;
}

interface BoundOccurrence {
	readonly range: AssistanceWorkflowSourceRangeV1;
	readonly source: DataRecord;
	readonly clip: DataRecord;
	readonly track: DataRecord;
}

interface BoundHighlight {
	readonly proposal: FramescaperAssistanceHighlightProposalV1;
	readonly sequenceFrameCount: number;
	readonly videoSourceStartFrame: number;
	readonly videoSourceEndFrame: number;
	readonly audioSourceStartFrame: number;
	readonly audioSourceEndFrame: number;
	readonly video: BoundOccurrence;
	readonly audio: BoundOccurrence;
}

interface NormalizedAuthority {
	readonly project: FramescaperProjectV31;
	readonly fence: AssistanceWorkflowFenceV1;
	readonly sequence: DataRecord;
	readonly highlights: readonly BoundHighlight[];
	readonly fingerprint: string;
}

const ID = /^[A-Za-z\d][A-Za-z\d._:-]{0,255}$/u;
const EXTENSION_KEY = 'org.soundscaper.assistance-highlights-v1';

export function createFramescaperAssistanceHighlightPublication(
	dependencies: FramescaperAssistanceHighlightPublicationDependencies,
): Readonly<FramescaperAssistanceHighlightPublication> {
	assertDependencies(dependencies);
	return Object.freeze({ acceptReviewed });

	async function acceptReviewed(
		value: unknown,
		selectedProposalIds: readonly string[] = [],
	): Promise<void> {
		const review = reviewFramescaperAssistanceHighlightsV1(value);
		const selected = selectProposals(review.proposals, selectedProposalIds);
		if (selected.length === 0) return;
		const initial = normalizeAuthority(dependencies.currentAuthority(), review.fence, selected);
		const command = publicationCommand(dependencies, initial);
		applyFramescaperProjectCommandV31(
			FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE,
			initial.project,
			command,
			{ now: String(initial.project.updatedAt) },
		);
		const token = dependencies.captureProject();
		assertAuthorityCurrent(dependencies, review.fence, selected, initial);
		dependencies.assertProject(token);
		assertAuthorityCurrent(dependencies, review.fence, selected, initial);
		await dependencies.commit(command);
	}
}

function selectProposals(
	proposals: readonly FramescaperAssistanceHighlightProposalV1[],
	value: unknown,
): readonly FramescaperAssistanceHighlightProposalV1[] {
	if (!Array.isArray(value) || value.length > proposals.length) {
		throw new RangeError('The selected highlight proposal set is out of range.');
	}
	const ids = value.map((candidate) => stableId(candidate, 'selected highlight ID'));
	if (new Set(ids).size !== ids.length) throw new TypeError('Selected highlight IDs must be unique.');
	const selected = new Set(ids);
	for (const id of selected) {
		if (!proposals.some((proposal) => proposal.id === id)) {
			throw new RangeError(`Unknown selected highlight ${id}.`);
		}
	}
	return Object.freeze(proposals.filter(({ id }) => selected.has(id)));
}

function normalizeAuthority(
	value: FramescaperAssistanceHighlightAuthority,
	expectedFence: AssistanceWorkflowFenceV1,
	proposals: readonly FramescaperAssistanceHighlightProposalV1[],
): NormalizedAuthority {
	if (!value || typeof value !== 'object') throw new TypeError('Highlight publication requires project authority.');
	const fence = validateAssistanceWorkflowFenceV1(value.fence);
	if (!same(expectedFence, fence)) throw new AssistanceProposalStaleError();
	validateFramescaperProjectV31(FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE, value.project);
	const project = value.project;
	if (project.id !== fence.projectId || project.schemaVersion !== fence.schemaVersion
		|| project.revision !== fence.revision) throw new AssistanceProposalStaleError();
	const sequence = recordArray(project.sequences, 'project sequences')
		.find(({ id }) => id === fence.sequenceId);
	if (!sequence) throw new AssistanceProposalStaleError();
	if (recordArray(project.multicameraGroups, 'multicamera groups')
		.some(({ sequenceId }) => sequenceId === fence.sequenceId)) {
		throw new RangeError('Highlight publication does not accept multicamera source authority.');
	}
	const highlights = proposals.map((proposal) => bindHighlight(project, fence, sequence, proposal));
	return Object.freeze({
		project, fence, sequence, highlights: Object.freeze(highlights),
		fingerprint: JSON.stringify({ fence, project }),
	});
}

function bindHighlight(
	project: FramescaperProjectV31,
	fence: AssistanceWorkflowFenceV1,
	sequence: DataRecord,
	proposal: FramescaperAssistanceHighlightProposalV1,
): BoundHighlight {
	const video = occurrence(project, fence, sequence, proposal.videoOccurrenceId, 'video');
	const audio = occurrence(project, fence, sequence, proposal.audioOccurrenceId, 'audio');
	if (video.clip.avLinkId === null || typeof video.clip.avLinkId !== 'string'
		|| video.clip.avLinkId !== audio.clip.avLinkId) {
		throw new RangeError('A highlight proposal must bind one exact linked A/V occurrence pair.');
	}
	const sampleRate = integer(project.sampleRate, 1, 'project sample rate');
	const sequenceRate = rationalRate(sequence.rate, 'sequence rate');
	const sequenceStart = exactSequenceFrame(proposal.startFrame, sequenceRate, sampleRate, 'highlight start');
	const sequenceEnd = exactSequenceFrame(proposal.endFrame, sequenceRate, sampleRate, 'highlight end');
	const clipSequenceStart = integer(video.clip.sequenceStartFrame, 0, 'video sequence start');
	const clipSequenceCount = integer(video.clip.sequenceFrameCount, 1, 'video sequence count');
	if (sequenceStart < clipSequenceStart || sequenceEnd > clipSequenceStart + clipSequenceCount
		|| sequenceEnd <= sequenceStart || video.clip.retimeMap !== null) {
		throw new RangeError('Highlight timing must remain inside one identity-retimed video occurrence.');
	}
	const clipSourceStart = integer(video.clip.sourceInFrame, 0, 'video source start');
	const clipSourceCount = integer(video.clip.sourceFrameCount, 1, 'video source count');
	const videoSourceStartFrame = safeAdd(clipSourceStart, mapBoundary(
		sequenceStart - clipSequenceStart, clipSourceCount, clipSequenceCount,
	), 'highlight video source start');
	const videoSourceEndFrame = safeAdd(clipSourceStart, mapBoundary(
		sequenceEnd - clipSequenceStart, clipSourceCount, clipSequenceCount,
	), 'highlight video source end');
	assertWithinRange(video.range, videoSourceStartFrame, videoSourceEndFrame, 'video');
	const audioClipStart = integer(audio.clip.timelineStartFrame, 0, 'audio timeline start');
	const audioDuration = integer(audio.clip.durationFrames, 1, 'audio duration');
	const audioSourceBase = integer(audio.clip.sourceStartFrame, 0, 'audio source start');
	if (proposal.startFrame < audioClipStart || proposal.endFrame > audioClipStart + audioDuration
		|| audio.clip.sourceDurationFrames !== audioDuration || audio.clip.speedRatio !== 1
		|| audio.clip.reversed === true || audio.clip.warpMap !== null) {
		throw new RangeError('Highlight timing must remain inside one identity-retimed audio occurrence.');
	}
	const audioSourceStartFrame = safeAdd(
		audioSourceBase, proposal.startFrame - audioClipStart, 'highlight audio source start',
	);
	const audioSourceEndFrame = safeAdd(
		audioSourceBase, proposal.endFrame - audioClipStart, 'highlight audio source end',
	);
	assertWithinRange(audio.range, audioSourceStartFrame, audioSourceEndFrame, 'audio');
	if (proposal.cropKeyframes[0]!.sourceFrame !== videoSourceStartFrame
		|| proposal.cropKeyframes.at(-1)!.sourceFrame !== videoSourceEndFrame - 1
		|| proposal.cropKeyframes.some(({ sourceFrame }) => (
			sourceFrame < videoSourceStartFrame || sourceFrame >= videoSourceEndFrame
		))) throw new RangeError('Highlight crop keyframes must bind the complete selected video source range.');
	return Object.freeze({
		proposal, sequenceFrameCount: sequenceEnd - sequenceStart,
		videoSourceStartFrame, videoSourceEndFrame, audioSourceStartFrame, audioSourceEndFrame,
		video, audio,
	});
}

function occurrence(
	project: FramescaperProjectV31,
	fence: AssistanceWorkflowFenceV1,
	sequence: DataRecord,
	occurrenceId: string,
	mediaKind: 'audio' | 'video',
): BoundOccurrence {
	const ranges = fence.sourceRanges.filter((range) => (
		range.mediaKind === mediaKind && range.occurrenceIds.includes(occurrenceId)
	));
	if (ranges.length !== 1 || ranges[0]!.retimeKind !== 'identity') {
		throw new RangeError(`Highlight ${mediaKind} occurrence authority must be unique and identity-retimed.`);
	}
	const range = ranges[0]!;
	const source = recordArray(project.sources, 'project sources').find(({ id }) => id === range.sourceId);
	const clip = recordArray(project.clips, 'project clips').find(({ id }) => id === occurrenceId);
	const track = recordArray(project.tracks, 'project tracks').find(({ clipIds }) => (
		Array.isArray(clipIds) && clipIds.includes(occurrenceId)
	));
	if (!source || !clip || !track || source.kind !== mediaKind || clip.kind !== mediaKind
		|| clip.sourceId !== source.id || source.contentSha256 !== range.sourceSha256
		|| track.type !== mediaKind || !array(sequence.trackIds, 'sequence track IDs').includes(track.id)) {
		throw new AssistanceProposalStaleError();
	}
	return Object.freeze({ range, source, clip, track });
}

function publicationCommand(
	dependencies: FramescaperAssistanceHighlightPublicationDependencies,
	authority: NormalizedAuthority,
): FramescaperProjectCommandV31 {
	const occupied = occupiedIds(authority.project);
	const commands: FramescaperProjectCommandV31[] = [];
	for (const highlight of authority.highlights) {
		commands.push(...highlightCommands(dependencies.createId, occupied, authority, highlight));
	}
	return Object.freeze({ type: 'batch', commands: Object.freeze(commands) }) as FramescaperProjectCommandV31;
}

function highlightCommands(
	createId: (prefix: string) => string,
	occupied: Set<string>,
	authority: NormalizedAuthority,
	highlight: BoundHighlight,
): readonly FramescaperProjectCommandV31[] {
	const next = (prefix: string): string => uniqueId(createId(prefix), occupied);
	const sequenceId = next('assistance-highlight-sequence');
	const videoTrackId = next('assistance-highlight-video-track');
	const audioTrackId = next('assistance-highlight-audio-track');
	const labelTrackId = next('assistance-highlight-label-track');
	const videoClipId = next('assistance-highlight-video-clip');
	const audioClipId = next('assistance-highlight-audio-clip');
	const laneGroupId = next('assistance-highlight-lane-group');
	const avLinkId = next('assistance-highlight-av-link');
	const labelId = next('assistance-highlight-label');
	const extension = Object.freeze({
		version: 1, workflowId: 'make-highlights', proposalId: highlight.proposal.id,
		sourceSequenceId: authority.fence.sequenceId,
		sourceStartFrame: highlight.proposal.startFrame,
		sourceEndFrame: highlight.proposal.endFrame,
	});
	const sequence = Object.freeze({
		id: sequenceId, name: highlight.proposal.title,
		rate: structuredClone(authority.sequence.rate),
		dropFrame: authority.sequence.dropFrame,
		startTimecode: structuredClone(authority.sequence.startTimecode),
		trackIds: Object.freeze([]), trackNodes: Object.freeze([]),
	});
	const videoClip = Object.freeze({
		kind: 'video', id: videoClipId, sourceId: String(highlight.video.source.id),
		title: highlight.proposal.title, sequenceId, sequenceStartFrame: 0,
		sequenceFrameCount: highlight.sequenceFrameCount,
		sourceInFrame: highlight.videoSourceStartFrame,
		sourceFrameCount: highlight.videoSourceEndFrame - highlight.videoSourceStartFrame,
		retimeMap: null, avLinkId, videoEffects: Object.freeze([]),
		videoComposition: DEFAULT_VIDEO_CLIP_COMPOSITION,
		opaqueExtensions: { [EXTENSION_KEY]: extension },
	});
	const audioDuration = highlight.audioSourceEndFrame - highlight.audioSourceStartFrame;
	const audioClip = createAudioClip({
		id: audioClipId, sourceId: String(highlight.audio.source.id), title: highlight.proposal.title,
		timelineStartFrame: 0, sourceStartFrame: highlight.audioSourceStartFrame,
		sourceDurationFrames: audioDuration, durationFrames: audioDuration, avLinkId,
		opaqueExtensions: { [EXTENSION_KEY]: extension },
	});
	const expectedKeyframes = createDefaultVideoKeyframeCurves(highlight.sequenceFrameCount);
	const keyframes = cropKeyframes(highlight);
	return Object.freeze([
		Object.freeze({ type: 'sequence/create', sequence }),
		Object.freeze({ ...createAddTrackCommand(createVideoTrack({
			id: videoTrackId, name: 'Video', laneGroupId,
			opaqueExtensions: { [EXTENSION_KEY]: extension },
		})), sequenceId }),
		Object.freeze({ ...createAddTrackCommand(createAudioTrack({
			id: audioTrackId, name: 'Audio', laneGroupId,
			opaqueExtensions: { [EXTENSION_KEY]: extension },
		}, Number(authority.project.sampleRate))), sequenceId }),
		createAddClipCommand(videoTrackId, videoClip),
		createAddClipCommand(audioTrackId, audioClip),
		createSetVideoKeyframesCommand(videoClipId, expectedKeyframes, keyframes),
		Object.freeze({ ...createAddTrackCommand(createLabelTrack({
			id: labelTrackId, name: 'Highlights', labels: [createLabel({
				id: labelId, title: highlight.proposal.title, startFrame: 0, endFrame: audioDuration,
				opaqueExtensions: { [EXTENSION_KEY]: extension },
			})], opaqueExtensions: { [EXTENSION_KEY]: extension },
		})), sequenceId }),
	] as FramescaperProjectCommandV31[]);
}

function cropKeyframes(highlight: BoundHighlight): DataRecord {
	const videoFrames = highlight.videoSourceEndFrame - highlight.videoSourceStartFrame;
	const anchors = highlight.proposal.cropKeyframes.map(({ sourceFrame, crop }) => Object.freeze({
		position: fraction(
			BigInt(sourceFrame - highlight.videoSourceStartFrame) * BigInt(highlight.sequenceFrameCount),
			BigInt(videoFrames),
		),
		crop,
	}));
	const parameterIds = ['bottom', 'left', 'right', 'top'] as const;
	const curves = parameterIds.map((parameterId) => ({
		target: { kind: 'composition', parameterId: `crop.${parameterId}` },
		curve: {
			anchors: anchors.map(({ position, crop }) => ({ position, value: crop[parameterId] })),
			segments: Array.from({ length: anchors.length - 1 }, () => ({ kind: 'linear' })),
		},
	}));
	return normalizeVideoKeyframeCurves({
		schemaVersion: 1,
		timeDomain: {
			authoredDuration: { num: highlight.sequenceFrameCount, den: 1 },
			viewStart: { num: 0, den: 1 },
			viewDuration: { num: highlight.sequenceFrameCount, den: 1 },
		},
		curves,
	}, {
		duration: highlight.sequenceFrameCount,
		composition: DEFAULT_VIDEO_CLIP_COMPOSITION,
		videoEffects: [],
	}) as unknown as DataRecord;
}

function assertAuthorityCurrent(
	dependencies: FramescaperAssistanceHighlightPublicationDependencies,
	fence: AssistanceWorkflowFenceV1,
	proposals: readonly FramescaperAssistanceHighlightProposalV1[],
	expected: NormalizedAuthority,
): void {
	const current = normalizeAuthority(dependencies.currentAuthority(), fence, proposals);
	if (current.fingerprint !== expected.fingerprint) throw new AssistanceProposalStaleError();
}

function assertWithinRange(
	range: AssistanceWorkflowSourceRangeV1,
	startFrame: number,
	endFrame: number,
	name: string,
): void {
	if (startFrame < range.sourceStartFrame || endFrame > range.sourceEndFrame
		|| endFrame <= startFrame) throw new RangeError(`Highlight ${name} timing escapes its aggregate fence.`);
}

function exactSequenceFrame(
	sampleFrame: number,
	rate: RationalRate,
	sampleRate: number,
	name: string,
): number {
	const result = sampleFrameToVideoFrame(sampleFrame, rate, sampleRate, 'point');
	if (videoFrameToSampleFrame(result, rate, sampleRate, 'point') !== sampleFrame) {
		throw new RangeError(`${name} must lie on an exact sequence-frame boundary.`);
	}
	return result;
}

function mapBoundary(offset: number, sourceCount: number, sequenceCount: number): number {
	const numerator = BigInt(offset) * BigInt(sourceCount);
	const denominator = BigInt(sequenceCount);
	if (numerator % denominator !== 0n) {
		throw new RangeError('Highlight timing cannot preserve an exact source boundary.');
	}
	const result = Number(numerator / denominator);
	if (!Number.isSafeInteger(result)) throw new RangeError('Highlight source timing overflowed.');
	return result;
}

function fraction(numeratorValue: bigint, denominatorValue: bigint): Readonly<{ num: number; den: number }> {
	const divisor = greatestCommonDivisor(numeratorValue, denominatorValue);
	const numerator = Number(numeratorValue / divisor);
	const denominator = Number(denominatorValue / divisor);
	if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)
		|| numerator < 0 || denominator < 1 || denominator > 1_000_000) {
		throw new RangeError('Highlight crop timing exceeds the exact rational domain.');
	}
	return Object.freeze({ num: numerator, den: denominator });
}

function greatestCommonDivisor(leftValue: bigint, rightValue: bigint): bigint {
	let left = leftValue < 0n ? -leftValue : leftValue;
	let right = rightValue < 0n ? -rightValue : rightValue;
	while (right !== 0n) [left, right] = [right, left % right];
	return left || 1n;
}

function occupiedIds(project: FramescaperProjectV31): Set<string> {
	const result = new Set<string>();
	for (const collection of [project.sources, project.clips, project.tracks, project.sequences,
		(project.projectBin as DataRecord).clips]) {
		for (const record of recordArray(collection, 'project identity collection')) {
			if (typeof record.id === 'string') result.add(record.id);
			if (Array.isArray(record.labels)) for (const label of recordArray(record.labels, 'track labels')) {
				if (typeof label.id === 'string') result.add(label.id);
			}
		}
	}
	return result;
}

function uniqueId(value: unknown, occupied: Set<string>): string {
	const result = stableId(value, 'created highlight identity');
	if (occupied.has(result)) throw new RangeError(`Duplicate highlight identity ${result}.`);
	occupied.add(result);
	return result;
}

function rationalRate(value: unknown, name: string): RationalRate {
	const record = exactRecord(value, ['num', 'den'], name);
	return Object.freeze({ num: integer(record.num, 1, `${name} numerator`),
		den: integer(record.den, 1, `${name} denominator`) });
}

function exactRecord(value: unknown, fields: readonly string[], name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`The ${name} must be a plain record.`);
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`The ${name} fields are invalid.`);
	}
	return value as Record<string, unknown>;
}

function array(value: unknown, name: string): readonly unknown[] {
	if (!Array.isArray(value)) throw new TypeError(`The ${name} must be an array.`);
	return value;
}

function recordArray(value: unknown, name: string): readonly DataRecord[] {
	return array(value, name).map((candidate, index) => {
		if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
			throw new TypeError(`The ${name}[${String(index)}] must be an object.`);
		}
		return candidate as DataRecord;
	});
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !ID.test(value)) throw new TypeError(`The ${name} is invalid.`);
	return value;
}

function integer(value: unknown, minimum: number, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum) throw new RangeError(`The ${name} is invalid.`);
	return Number(value);
}

function safeAdd(left: number, right: number, name: string): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw new RangeError(`The ${name} overflowed.`);
	return result;
}

function same(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function assertDependencies(value: FramescaperAssistanceHighlightPublicationDependencies): void {
	if (!value || typeof value !== 'object' || typeof value.currentAuthority !== 'function'
		|| typeof value.captureProject !== 'function' || typeof value.assertProject !== 'function'
		|| typeof value.createId !== 'function' || typeof value.commit !== 'function') {
		throw new TypeError('Highlight publication requires all transaction dependencies.');
	}
}

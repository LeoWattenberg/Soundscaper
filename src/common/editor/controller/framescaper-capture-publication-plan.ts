/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAddClipCommand, createAddSourceCommand, createAddTrackCommand } from '../commands/factories.ts';
import type { AudioEditorCommand, CommandObject } from '../commands/protocol.ts';
import type { CaptureDestination, CaptureSourceRole } from '../framescaper-capture-domain.ts';
import { sampleFrameToVideoFrame, videoFrameRangeToSampleRange, type RationalRate } from '../timeline-time.ts';
import { normalizeFramescaperCaptureExactPresentationRange, type FramescaperCaptureExactPresentationRange } from './framescaper-capture-exact-presentation-range.ts';

const ROLE_ORDER = Object.freeze([
	'camera', 'microphone', 'display', 'system-audio',
] as const satisfies readonly CaptureSourceRole[]);
const MAXIMUM_CAPTURE_EXTENSION_BYTES = 4_096;

export type FramescaperCaptureRecoveryProvenance = 'live' | 'recovered' | 'import-as-is';
export type FramescaperCaptureMetricConfidence = 'exact' | 'estimated' | 'unavailable';

export interface FramescaperCapturePublicationMetrics {
	readonly confidence: FramescaperCaptureMetricConfidence;
	readonly droppedUnits: number | null;
	readonly maximumAbsoluteDriftMicroseconds: number | null;
	readonly finalDriftMicroseconds: number | null;
}

export interface FramescaperFinalizedCaptureStream {
	readonly streamId: string;
	readonly role: CaptureSourceRole;
	/** Offset from the capture session's record-start position, in project samples. */
	readonly startOffsetFrames: number;
	readonly presentationEndOffsetFrames: number;
	readonly exactPresentationRange?: FramescaperCaptureExactPresentationRange | null;
	/** Exact presentation duration after final probe, in project samples. */
	readonly timelineDurationFrames: number;
	readonly metrics: FramescaperCapturePublicationMetrics;
	readonly terminationReason: string | null;
}

export interface FramescaperCaptureDurableStream extends FramescaperFinalizedCaptureStream {
	/** An ordinary, already-durable audio or video source descriptor. */
	readonly source: Readonly<Record<string, unknown>>;
}

export interface FramescaperCapturePublicationSequence {
	readonly id: string;
	readonly rate: RationalRate;
}

export interface FramescaperCapturePublicationPlanRequest {
	readonly sessionId: string;
	readonly manifestSha256: string;
	readonly recoveryProvenance: FramescaperCaptureRecoveryProvenance;
	readonly destination?: CaptureDestination;
	readonly recordStartFrame: number;
	readonly projectSampleRate: number;
	readonly sequence: FramescaperCapturePublicationSequence;
	readonly trackInsertionIndex: number;
	readonly streams: readonly FramescaperCaptureDurableStream[];
	readonly createId: (prefix: string) => string;
}

export interface FramescaperCapturePublicationPlanEntry {
	readonly streamId: string;
	readonly role: CaptureSourceRole;
	readonly sourceId: string;
	readonly binItemId: string | null;
	readonly binClipId: string | null;
	readonly trackId: string | null;
	readonly trackIndex: number | null;
	readonly timelineClipId: string | null;
	readonly groupId: string | null;
	readonly laneGroupId: string | null;
	readonly avLinkId: string | null;
}

export type FramescaperCapturePublicationBatchCommand = Extract<
	AudioEditorCommand,
	{ readonly type: 'batch' }
>;

export interface FramescaperCapturePublicationPlan {
	readonly destination: CaptureDestination;
	readonly command: FramescaperCapturePublicationBatchCommand;
	readonly entries: readonly FramescaperCapturePublicationPlanEntry[];
}

interface NormalizedStream extends FramescaperCaptureDurableStream {
	readonly source: CommandObject;
	readonly sourceId: string;
	readonly timelineStartFrame: number;
	readonly timelineEndFrame: number;
	readonly sequenceStartFrame: number | null;
	readonly sequenceFrameCount: number | null;
}

interface LinkIdentity {
	readonly laneGroupId: string;
	readonly avLinkId: string;
}

/**
 * Produce the only document mutation for a completed capture. The caller owns
 * durable media publication; this planner owns no I/O and never mutates input.
 */
export function planFramescaperCapturePublication(
	request: FramescaperCapturePublicationPlanRequest,
): Readonly<FramescaperCapturePublicationPlan> {
	const sessionId = stableText(request.sessionId, 'capture publication sessionId', 256);
	const manifestSha256 = sha256(request.manifestSha256, 'capture publication manifest SHA-256');
	const destination = normalizeDestination(request.destination ?? 'both');
	const recoveryProvenance = normalizeRecoveryProvenance(request.recoveryProvenance);
	const recordStartFrame = nonNegativeInteger(request.recordStartFrame, 'capture record-start frame');
	const projectSampleRate = positiveInteger(request.projectSampleRate, 'capture project sample rate');
	const trackInsertionIndex = nonNegativeInteger(request.trackInsertionIndex, 'capture track insertion index');
	const sequence = normalizeSequence(request.sequence);
	if (typeof request.createId !== 'function') throw new TypeError('Capture publication requires an ID factory.');
	const streams = normalizeStreams(request.streams, {
		sessionId, manifestSha256, recoveryProvenance, recordStartFrame,
		projectSampleRate, sequence,
	});
	const links = destination === 'project-bin'
		? new Map<CaptureSourceRole, LinkIdentity>()
		: planExactLinks(streams, request.createId);
	const commands: AudioEditorCommand[] = streams.map((stream) => createAddSourceCommand(stream.source));
	const mutableEntries = new Map<CaptureSourceRole, FramescaperCapturePublicationPlanEntry>();

	if (destination !== 'timeline') for (const stream of streams) {
		const binItemId = createOwnedId(request.createId, 'capture-bin-item');
		const binClipId = createOwnedId(request.createId, `${stream.role}-capture-bin-clip`);
		commands.push(projectBinAddCommand(createClip(stream, {
			id: binClipId,
			sequence,
			timelineStartFrame: 0,
			groupId: null,
			avLinkId: null,
			binItemId,
			forProjectBin: true,
		})));
		mutableEntries.set(stream.role, entryFor(stream, {
			binItemId, binClipId,
		}));
	}

	if (destination !== 'project-bin') {
		const trackCommands: AudioEditorCommand[] = [];
		const clipCommands: AudioEditorCommand[] = [];
		const linkCommands: AudioEditorCommand[] = [];
		const linked = new Set<string>();
		for (const [offset, stream] of streams.entries()) {
			const link = links.get(stream.role) ?? null;
			const trackId = createOwnedId(request.createId, `${stream.role}-capture-track`);
			const timelineClipId = createOwnedId(request.createId, `${stream.role}-capture-clip`);
			const trackIndex = exactSum(trackInsertionIndex, offset, 'capture track index');
			const trackCommand = createAddTrackCommand({
				type: sourceKind(stream.source),
				id: trackId,
				name: trackName(stream.role),
				laneGroupId: link?.laneGroupId ?? null,
				armed: false,
				opaqueExtensions: {},
			});
			trackCommands.push({
				...trackCommand,
				index: trackIndex,
				sequenceId: sequence.id,
			} as AudioEditorCommand);
			// Add both members without a link first. Current Framescaper command
			// models validate fresh video boundaries independently; clip/link-av
			// then assigns both IDs in one invariant-preserving child command.
			clipCommands.push(createAddClipCommand(trackId, createClip(stream, {
				id: timelineClipId,
				sequence,
				timelineStartFrame: stream.timelineStartFrame,
				groupId: sessionId,
				avLinkId: null,
				binItemId: null,
				forProjectBin: false,
			})));
			const previous = mutableEntries.get(stream.role);
			mutableEntries.set(stream.role, entryFor(stream, {
				binItemId: previous?.binItemId ?? null,
				binClipId: previous?.binClipId ?? null,
				trackId,
				trackIndex,
				timelineClipId,
				groupId: sessionId,
				laneGroupId: link?.laneGroupId ?? null,
				avLinkId: link?.avLinkId ?? null,
			}));
		}
		for (const stream of streams) {
			const link = links.get(stream.role);
			if (!link || linked.has(link.avLinkId) || sourceKind(stream.source) !== 'video') continue;
			const audioRole = stream.role === 'camera' ? 'microphone' : 'system-audio';
			const videoEntry = mutableEntries.get(stream.role);
			const audioEntry = mutableEntries.get(audioRole);
			if (!videoEntry?.timelineClipId || !audioEntry?.timelineClipId) {
				throw new Error(`Capture publication omitted the ${stream.role} A/V pair.`);
			}
			linkCommands.push({
				type: 'clip/link-av',
				videoClipId: videoEntry.timelineClipId,
				audioClipId: audioEntry.timelineClipId,
				avLinkId: link.avLinkId,
			});
			linked.add(link.avLinkId);
		}
		commands.push(...trackCommands, ...clipCommands, ...linkCommands);
	}

	if (!commands.length) throw new Error('Capture publication produced an empty command batch.');
	const entries = Object.freeze(streams.map((stream) => {
		const entry = mutableEntries.get(stream.role);
		if (!entry) throw new Error(`Capture publication omitted ${stream.role}.`);
		return Object.freeze(entry);
	}));
	return Object.freeze({
		destination,
		command: Object.freeze({ type: 'batch', commands: Object.freeze(commands) }),
		entries,
	});
}

function normalizeStreams(
	value: readonly FramescaperCaptureDurableStream[],
	context: Readonly<{
		readonly sessionId: string;
		readonly manifestSha256: string;
		readonly recoveryProvenance: FramescaperCaptureRecoveryProvenance;
		readonly recordStartFrame: number;
		readonly projectSampleRate: number;
		readonly sequence: FramescaperCapturePublicationSequence;
	}>,
): readonly NormalizedStream[] {
	if (!Array.isArray(value) || value.length < 1 || value.length > ROLE_ORDER.length) {
		throw new RangeError('Capture publication requires one through four streams.');
	}
	const roles = new Set<CaptureSourceRole>();
	const streamIds = new Set<string>();
	const sourceIds = new Set<string>();
	const normalized = value.map((input): NormalizedStream => {
		const streamId = stableText(input.streamId, 'capture publication streamId', 256);
		const role = normalizeRole(input.role);
		if (roles.has(role)) throw new RangeError('Capture publication stream roles must be unique.');
		if (streamIds.has(streamId)) throw new RangeError('Capture publication stream IDs must be unique.');
		roles.add(role);
		streamIds.add(streamId);
		const startOffsetFrames = nonNegativeInteger(input.startOffsetFrames, `${role} start offset`);
		const presentationEndOffsetFrames = positiveInteger(input.presentationEndOffsetFrames, `${role} presentation end offset`);
		if (presentationEndOffsetFrames <= startOffsetFrames) throw new RangeError(`Capture ${role} presentation range must have positive duration.`);
		const exactPresentationRange = normalizeFramescaperCaptureExactPresentationRange(input.exactPresentationRange);
		const timelineDurationFrames = positiveInteger(input.timelineDurationFrames, `${role} timeline duration`);
		const timelineStartFrame = exactSum(context.recordStartFrame, startOffsetFrames, `${role} timeline start`);
		const timelineEndFrame = exactSum(timelineStartFrame, timelineDurationFrames, `${role} timeline end`);
		const source = captureSource(input.source, {
			sessionId: context.sessionId,
			streamId,
			role,
			manifestSha256: context.manifestSha256,
			recoveryProvenance: context.recoveryProvenance,
			startOffsetFrames,
			presentationEndOffsetFrames,
			exactPresentationRange,
			timelineDurationFrames,
			metrics: normalizeMetrics(input.metrics),
			terminationReason: nullableStableText(input.terminationReason, `${role} termination reason`, 256),
		});
		const sourceId = stableText(source.id, `${role} source ID`, 256);
		if (sourceIds.has(sourceId)) throw new RangeError('Capture publication source IDs must be unique.');
		sourceIds.add(sourceId);
		const kind = sourceKind(source);
		if ((role === 'camera' || role === 'display') !== (kind === 'video')) {
			throw new RangeError(`Capture ${role} requires an ordinary ${role === 'camera' || role === 'display' ? 'video' : 'audio'} source.`);
		}
		validateSourceGeometry(source, role);
		if (kind === 'audio') return Object.freeze({
			...input, streamId, role, source, sourceId, startOffsetFrames, presentationEndOffsetFrames, exactPresentationRange, timelineDurationFrames,
			metrics: normalizeMetrics(input.metrics),
			terminationReason: nullableStableText(input.terminationReason, `${role} termination reason`, 256),
			timelineStartFrame, timelineEndFrame,
			sequenceStartFrame: null, sequenceFrameCount: null,
		});
		const sequenceStartFrame = sampleFrameToVideoFrame(
			timelineStartFrame, context.sequence.rate, context.projectSampleRate, 'point',
		);
		const sequenceEndFrame = Math.max(sequenceStartFrame + 1, sampleFrameToVideoFrame(
			timelineEndFrame, context.sequence.rate, context.projectSampleRate, 'point',
		));
		const range = videoFrameRangeToSampleRange(
			sequenceStartFrame,
			sequenceEndFrame - sequenceStartFrame,
			context.sequence.rate,
			context.projectSampleRate,
		);
		return Object.freeze({
			...input, streamId, role, source, sourceId, startOffsetFrames, presentationEndOffsetFrames, exactPresentationRange, timelineDurationFrames,
			metrics: normalizeMetrics(input.metrics),
			terminationReason: nullableStableText(input.terminationReason, `${role} termination reason`, 256),
			timelineStartFrame: range.startFrame,
			timelineEndFrame: range.endFrame,
			sequenceStartFrame,
			sequenceFrameCount: sequenceEndFrame - sequenceStartFrame,
		});
	});
	if (roles.has('system-audio') && !roles.has('display')) {
		throw new RangeError('Capture publication system audio requires its display stream.');
	}
	return Object.freeze([...normalized].sort((left, right) => (
		ROLE_ORDER.indexOf(left.role) - ROLE_ORDER.indexOf(right.role)
	)));
}

function captureSource(
	value: Readonly<Record<string, unknown>>,
	summary: Readonly<Record<string, unknown>>,
): CommandObject {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('A durable capture source must be a data record.');
	}
	const existing = value.opaqueExtensions ?? {};
	if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
		throw new TypeError('A durable capture source opaqueExtensions value must be a data record.');
	}
	if (Object.hasOwn(existing, 'framescaperCaptureV1')) {
		throw new RangeError('A durable capture source already carries capture provenance.');
	}
	const kind = sourceKind(value);
	const format = kind === 'video'
		? Object.freeze({
			kind,
			mimeType: stableText(value.mimeType, 'capture video MIME type', 255),
		})
		: Object.freeze({
			kind,
			mimeType: stableText(value.mimeType, 'capture audio MIME type', 255),
			sampleFormat: stableText(value.sampleFormat, 'capture audio sample format', 32),
			sampleRate: positiveInteger(value.sampleRate, 'capture audio sample rate'),
			channelCount: positiveInteger(value.channelCount, 'capture audio channel count'),
		});
	const captureSummary = Object.freeze({ ...summary, format });
	const serialized = JSON.stringify(captureSummary);
	if (serialized.length > MAXIMUM_CAPTURE_EXTENSION_BYTES) {
		throw new RangeError('Capture publication provenance exceeds its strict byte bound.');
	}
	return structuredClone({
		...value,
		opaqueExtensions: {
			...existing as Readonly<Record<string, unknown>>,
			framescaperCaptureV1: captureSummary,
		},
	}) as CommandObject;
}

function planExactLinks(
	streams: readonly NormalizedStream[],
	createId: (prefix: string) => string,
): ReadonlyMap<CaptureSourceRole, LinkIdentity> {
	const byRole = new Map(streams.map((stream) => [stream.role, stream]));
	const result = new Map<CaptureSourceRole, LinkIdentity>();
	for (const [videoRole, audioRole] of [
		['camera', 'microphone'],
		['display', 'system-audio'],
	] as const) {
		const video = byRole.get(videoRole);
		const audio = byRole.get(audioRole);
		if (!video || !audio
			|| video.timelineStartFrame !== audio.timelineStartFrame
			|| video.timelineEndFrame !== audio.timelineEndFrame
			|| video.startOffsetFrames !== audio.startOffsetFrames
			|| video.presentationEndOffsetFrames !== audio.presentationEndOffsetFrames
			|| video.exactPresentationRange === null
			|| video.exactPresentationRange !== audio.exactPresentationRange) continue;
		const link = Object.freeze({
			laneGroupId: createOwnedId(createId, `${videoRole}-capture-lanes`),
			avLinkId: createOwnedId(createId, `${videoRole}-capture-av-link`),
		});
		result.set(videoRole, link);
		result.set(audioRole, link);
	}
	return result;
}

function createClip(
	stream: NormalizedStream,
	options: Readonly<{
		readonly id: string;
		readonly sequence: FramescaperCapturePublicationSequence;
		readonly timelineStartFrame: number;
		readonly groupId: string | null;
		readonly avLinkId: string | null;
		readonly binItemId: string | null;
		readonly forProjectBin: boolean;
	}>,
): CommandObject {
	const common = {
		kind: sourceKind(stream.source),
		id: options.id,
		sourceId: stream.sourceId,
		title: String(stream.source.name),
		trimStartFrames: 0,
		trimEndFrames: 0,
		groupId: options.groupId,
		color: 'auto',
		avLinkId: options.avLinkId,
		binItemId: options.binItemId,
		opaqueExtensions: {},
	};
	if (common.kind === 'audio') return {
		...common,
		anchor: 'sample',
		musicalStartBeat: null,
		musicalExtent: 'fixedSamples',
		musicalDurationBeats: null,
		timelineStartFrame: options.timelineStartFrame,
		durationFrames: stream.timelineEndFrame - stream.timelineStartFrame,
		sourceStartFrame: 0,
		sourceDurationFrames: positiveInteger(stream.source.frameCount, `${stream.role} audio frame count`),
		warpMap: null,
	} as CommandObject;
	const sequenceStartFrame = options.forProjectBin ? 0 : requireInteger(stream.sequenceStartFrame);
	return {
		...common,
		sequenceId: options.sequence.id,
		sequenceStartFrame,
		sequenceFrameCount: requireInteger(stream.sequenceFrameCount),
		sourceInFrame: 0,
		sourceFrameCount: positiveInteger(stream.source.sourceFrameCount, `${stream.role} video frame count`),
		retimeMap: null,
		speedRatio: 1,
		videoEffects: [],
	} as CommandObject;
}

function projectBinAddCommand(clip: CommandObject): AudioEditorCommand {
	return { type: 'project-bin/add', clip };
}

function entryFor(
	stream: NormalizedStream,
	changes: Partial<FramescaperCapturePublicationPlanEntry>,
): FramescaperCapturePublicationPlanEntry {
	return {
		streamId: stream.streamId,
		role: stream.role,
		sourceId: stream.sourceId,
		binItemId: null,
		binClipId: null,
		trackId: null,
		trackIndex: null,
		timelineClipId: null,
		groupId: null,
		laneGroupId: null,
		avLinkId: null,
		...changes,
	};
}

function normalizeMetrics(value: FramescaperCapturePublicationMetrics): FramescaperCapturePublicationMetrics {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Capture publication metrics must be a data record.');
	}
	const confidence = value.confidence;
	if (confidence !== 'exact' && confidence !== 'estimated' && confidence !== 'unavailable') {
		throw new TypeError('Capture publication metric confidence is invalid.');
	}
	if (confidence === 'unavailable') {
		if (value.droppedUnits !== null || value.maximumAbsoluteDriftMicroseconds !== null
			|| value.finalDriftMicroseconds !== null) {
			throw new RangeError('Unavailable capture metrics cannot report numeric values.');
		}
	} else {
		nonNegativeInteger(value.droppedUnits, 'capture dropped units');
		nonNegativeInteger(value.maximumAbsoluteDriftMicroseconds, 'capture maximum drift');
		safeInteger(value.finalDriftMicroseconds, 'capture final drift');
	}
	return Object.freeze({
		confidence,
		droppedUnits: value.droppedUnits,
		maximumAbsoluteDriftMicroseconds: value.maximumAbsoluteDriftMicroseconds,
		finalDriftMicroseconds: value.finalDriftMicroseconds,
	});
}

function validateSourceGeometry(source: CommandObject, role: CaptureSourceRole): void {
	stableText(source.storageKey, `${role} source storage key`, 512);
	stableText(source.name, `${role} source name`, 512);
	stableText(source.mimeType, `${role} source MIME type`, 255);
	positiveInteger(source.sampleRate, `${role} source sample rate`);
	if (sourceKind(source) === 'audio') {
		positiveInteger(source.frameCount, `${role} source frame count`);
		positiveInteger(source.channelCount, `${role} source channel count`);
		return;
	}
	positiveInteger(source.sampleFrameCount, `${role} video sample duration`);
	positiveInteger(source.sourceFrameCount, `${role} video frame count`);
	positiveInteger(source.width, `${role} video width`);
	positiveInteger(source.height, `${role} video height`);
}

function normalizeSequence(value: FramescaperCapturePublicationSequence): FramescaperCapturePublicationSequence {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Capture publication sequence must be a data record.');
	}
	const num = positiveInteger(value.rate?.num, 'capture sequence rate numerator');
	const den = positiveInteger(value.rate?.den, 'capture sequence rate denominator');
	return Object.freeze({
		id: stableText(value.id, 'capture sequence ID', 256),
		rate: Object.freeze({ num, den }),
	});
}

function normalizeRole(value: unknown): CaptureSourceRole {
	if (value !== 'camera' && value !== 'microphone' && value !== 'display' && value !== 'system-audio') {
		throw new TypeError('Capture publication source role is invalid.');
	}
	return value;
}

function normalizeDestination(value: unknown): CaptureDestination {
	if (value !== 'project-bin' && value !== 'timeline' && value !== 'both') {
		throw new TypeError('Capture publication destination is invalid.');
	}
	return value;
}

function normalizeRecoveryProvenance(value: unknown): FramescaperCaptureRecoveryProvenance {
	if (value !== 'live' && value !== 'recovered' && value !== 'import-as-is') {
		throw new TypeError('Capture recovery provenance is invalid.');
	}
	return value;
}

function sourceKind(source: Readonly<Record<string, unknown>>): 'audio' | 'video' {
	if (source.kind !== 'audio' && source.kind !== 'video') {
		throw new TypeError('A capture publication source requires an ordinary media kind.');
	}
	return source.kind;
}

function trackName(role: CaptureSourceRole): string {
	switch (role) {
		case 'camera': return 'Camera';
		case 'microphone': return 'Microphone';
		case 'display': return 'Screen';
		case 'system-audio': return 'System Audio';
	}
}

function createOwnedId(createId: (prefix: string) => string, prefix: string): string {
	return stableText(createId(prefix), `${prefix} ID`, 256);
}

function sha256(value: unknown, name: string): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) throw new TypeError(`${name} is invalid.`);
	return value;
}

function stableText(value: unknown, name: string, maximumLength: number): string {
	if (typeof value !== 'string' || !value.length || value !== value.trim()
		|| value.length > maximumLength || /[\u0000-\u001f\u007f]/u.test(value)) {
		throw new TypeError(`${name} is invalid.`);
	}
	return value;
}

function nullableStableText(value: unknown, name: string, maximumLength: number): string | null {
	return value === null ? null : stableText(value, name, maximumLength);
}

function safeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value)) throw new RangeError(`${name} must be a safe integer.`);
	return Number(value);
}

function nonNegativeInteger(value: unknown, name: string): number {
	const result = safeInteger(value, name);
	if (result < 0) throw new RangeError(`${name} must be non-negative.`);
	return result;
}

function positiveInteger(value: unknown, name: string): number {
	const result = safeInteger(value, name);
	if (result < 1) throw new RangeError(`${name} must be positive.`);
	return result;
}

function requireInteger(value: number | null): number {
	if (value === null) throw new TypeError('Capture video placement is unavailable.');
	return value;
}

function exactSum(left: number, right: number, name: string): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw new RangeError(`${name} exceeds the safe integer range.`);
	return result;
}

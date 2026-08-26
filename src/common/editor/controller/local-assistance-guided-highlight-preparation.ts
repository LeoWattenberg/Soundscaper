/* SPDX-License-Identifier: AGPL-3.0-only */

/** Linked A/V custody preparation for deterministic Make Highlights signals. */

import { scaleSampleFrame } from '../timeline-time.ts';
import type { AssistanceWorkflowSettingsV1 } from '../assistance/workflow-settings-v1.ts';
import {
	createLocalAssistanceGuidedHighlightAudioSignalsV1,
	createLocalAssistanceGuidedHighlightVideoSignalsV1,
} from './local-assistance-guided-highlight-signals.ts';
import {
	createLocalAssistanceGuidedHighlightTranscriptSignalsV1,
} from './local-assistance-guided-highlight-transcript.ts';
import {
	prepareLocalAssistanceGuidedTranscriptInput,
	type LocalAssistanceGuidedExternalInput,
	type LocalAssistanceGuidedPrimitiveFence,
} from './local-assistance-guided-transcript-context.ts';
import type { LocalAssistanceSelectedVideoSourceTimeDescriptorV1 } from
	'./local-assistance-selected-video-source-time.ts';

const VIDEO_SIGNALS_MEDIA_TYPE =
	'application/vnd.soundscaper.highlight-video-signals+json';
const AUDIO_SIGNALS_MEDIA_TYPE =
	'application/vnd.soundscaper.highlight-audio-signals+json';
const TRANSCRIPT_SIGNALS_MEDIA_TYPE =
	'application/vnd.soundscaper.highlight-transcript-signals+json';
const MAXIMUM_SIGNAL_BYTES = 64 * 1024 * 1024;
const SHA256 = /^[a-f\d]{64}$/u;

interface InventorySource {
	readonly sourceId: string;
	readonly mediaKind: string;
}

interface PreparedSelectedMediaPort {
	(request: Readonly<{
		readonly sourceId: string;
		readonly operation: 'audio-tagging';
		readonly signal?: AbortSignal;
	}>): Promise<unknown>;
}

export interface LocalAssistanceGuidedHighlightPreparationRequestV1 {
	readonly project: Readonly<Record<string, unknown>>;
	readonly inventory: readonly InventorySource[];
	readonly settings: AssistanceWorkflowSettingsV1;
	readonly signal: AbortSignal;
	readonly describeSelectedVideoSourceTime: () => Promise<unknown>;
	readonly prepareSelectedMedia: PreparedSelectedMediaPort;
	readonly loadTranscriptBody?: (
		storageKey: string,
		signal: AbortSignal,
	) => PromiseLike<unknown> | unknown;
}

export interface LocalAssistanceGuidedHighlightPreparedInputsV1 {
	readonly video: LocalAssistanceGuidedExternalInput;
	readonly audio: LocalAssistanceGuidedExternalInput;
	readonly transcript: LocalAssistanceGuidedExternalInput | null;
	readonly audioWave: LocalAssistanceGuidedExternalInput;
}

export async function prepareLocalAssistanceGuidedHighlightInputsV1(
	request: LocalAssistanceGuidedHighlightPreparationRequestV1,
): Promise<LocalAssistanceGuidedHighlightPreparedInputsV1 | null> {
	if (!(request?.signal instanceof AbortSignal)) {
		throw new TypeError('Highlight preparation requires one cancellation signal.');
	}
	request.signal.throwIfAborted();
	const described = record(await request.describeSelectedVideoSourceTime(),
		'selected-video source-time description');
	request.signal.throwIfAborted();
	const videoFence = primitiveFence(described.selectionFence);
	const authority = sourceTimeAuthority(described.descriptor, videoFence);
	const linked = linkedAudio(request.project, authority);
	if (linked === null) return null;
	const inventory = request.inventory.filter(({ sourceId, mediaKind }) => (
		sourceId === linked.sourceId && mediaKind === 'audio'
	));
	if (inventory.length !== 1) return null;

	const prepared = preparedAudio(await request.prepareSelectedMedia({
		sourceId: linked.sourceId, operation: 'audio-tagging', signal: request.signal,
	}), linked.sourceId);
	request.signal.throwIfAborted();
	assertLinkedFence(prepared.fence, videoFence, authority.videoOccurrenceId,
		linked.occurrenceId, linked.sampleRate, authority);
	const videoSignals = createLocalAssistanceGuidedHighlightVideoSignalsV1({
		authority, audioOccurrenceId: linked.occurrenceId, settings: request.settings,
	});
	const audioSignals = await createLocalAssistanceGuidedHighlightAudioSignalsV1({
		body: prepared.body, video: videoSignals, signal: request.signal,
	});
	const transcriptInput = await prepareLocalAssistanceGuidedTranscriptInput({
		project: request.project, inventory: request.inventory, fence: prepared.fence,
		loadTranscriptBody: request.loadTranscriptBody, signal: request.signal,
	});
	const transcriptSignals = transcriptInput === null ? null
		: await createLocalAssistanceGuidedHighlightTranscriptSignalsV1({
			body: transcriptInput.bytes, video: videoSignals, audioSourceId: linked.sourceId,
			audioSourceStartFrame: prepared.fence.sourceStartFrame,
			audioSourceEndFrame: prepared.fence.sourceEndFrame, signal: request.signal,
		});
	return Object.freeze({
		video: jsonInput(videoSignals, VIDEO_SIGNALS_MEDIA_TYPE, videoFence),
		audio: jsonInput(audioSignals, AUDIO_SIGNALS_MEDIA_TYPE, prepared.fence),
		transcript: transcriptSignals === null ? null
			: jsonInput(transcriptSignals, TRANSCRIPT_SIGNALS_MEDIA_TYPE, prepared.fence),
		audioWave: Object.freeze({ mediaType: prepared.body.type,
			bytes: prepared.body, fence: prepared.fence }),
	});
}

function linkedAudio(
	project: Readonly<Record<string, unknown>>,
	authority: LocalAssistanceSelectedVideoSourceTimeDescriptorV1,
): Readonly<{ occurrenceId: string; sourceId: string; sampleRate: number }> | null {
	const clips = records(project.clips);
	const video = clips.filter(({ id }) => id === authority.videoOccurrenceId);
	if (video.length !== 1 || video[0]!.kind !== 'video'
		|| video[0]!.sourceId !== authority.sourceId
		|| video[0]!.sequenceId !== authority.sequenceId
		|| typeof video[0]!.avLinkId !== 'string' || video[0]!.avLinkId === '') return null;
	const audio = clips.filter(({ kind, avLinkId, sequenceId }) => kind === 'audio'
		&& avLinkId === video[0]!.avLinkId && sequenceId === authority.sequenceId);
	if (audio.length !== 1 || typeof audio[0]!.id !== 'string'
		|| typeof audio[0]!.sourceId !== 'string') return null;
	const sources = records(project.sources).filter(({ id, kind }) => (
		id === audio[0]!.sourceId && kind === 'audio'
	));
	if (sources.length !== 1) return null;
	return Object.freeze({ occurrenceId: audio[0]!.id, sourceId: audio[0]!.sourceId,
		sampleRate: integer(sources[0]!.sampleRate, 1, 'linked audio sample rate') });
}

function preparedAudio(value: unknown, sourceId: string): Readonly<{
	body: Blob; fence: LocalAssistanceGuidedPrimitiveFence;
}> {
	const row = record(value, 'prepared highlight audio');
	if (row.sourceId !== sourceId || row.operation !== 'audio-tagging'
		|| !Array.isArray(row.inputs)) {
		throw new TypeError('Prepared highlight audio lost exact source authority.');
	}
	const matches = row.inputs.map((value) => record(value, 'prepared highlight input'))
		.filter(({ role }) => role === 'audio');
	if (matches.length !== 1 || matches[0]!.mediaType !== 'audio/wav'
		|| !(matches[0]!.bytes instanceof Blob) || matches[0]!.bytes.size < 44
		|| matches[0]!.bytes.type !== 'audio/wav') {
		throw new TypeError('Prepared highlight audio is not one authenticated WAV input.');
	}
	return Object.freeze({ body: matches[0]!.bytes,
		fence: primitiveFence(row.selectionFence) });
}

function assertLinkedFence(
	audio: LocalAssistanceGuidedPrimitiveFence,
	video: LocalAssistanceGuidedPrimitiveFence,
	videoOccurrenceId: string,
	audioOccurrenceId: string,
	audioSampleRate: number,
	authority: LocalAssistanceSelectedVideoSourceTimeDescriptorV1,
): void {
	if (audio.projectId !== video.projectId || audio.revision !== video.revision
		|| audio.sequenceId !== video.sequenceId
		|| audio.linkMembershipSha256 !== video.linkMembershipSha256
		|| !audio.occurrenceIds.includes(videoOccurrenceId)
		|| !audio.occurrenceIds.includes(audioOccurrenceId)
		|| !video.occurrenceIds.includes(videoOccurrenceId)
		|| !video.occurrenceIds.includes(audioOccurrenceId)) {
		throw new Error('Highlight linked occurrence authority changed during preparation.');
	}
	const audioDuration = audio.sourceEndFrame - audio.sourceStartFrame;
	const videoDuration = authority.selectionEndFrame - authority.selectionStartFrame;
	if (Number(scaleSampleFrame(audioDuration, audioSampleRate,
		authority.sampleRate, 'point')) !== videoDuration) {
		throw new RangeError('Highlight linked A/V durations disagree.');
	}
}

function sourceTimeAuthority(
	value: unknown,
	fence: LocalAssistanceGuidedPrimitiveFence,
): LocalAssistanceSelectedVideoSourceTimeDescriptorV1 {
	const row = record(value, 'selected-video source-time authority');
	if (row.schemaVersion !== 1 || row.kind !== 'selected-video-source-time-authority'
		|| row.projectId !== fence.projectId || row.projectRevision !== fence.revision
		|| row.sequenceId !== fence.sequenceId || row.sourceId !== fence.sourceId
		|| row.sourceSha256 !== fence.sourceSha256
		|| row.timingAuthoritySha256 !== fence.timingAuthoritySha256
		|| row.sourceStartFrame !== fence.sourceStartFrame
		|| row.sourceEndFrame !== fence.sourceEndFrame
		|| typeof row.videoOccurrenceId !== 'string'
		|| !fence.occurrenceIds.includes(row.videoOccurrenceId)) {
		throw new Error('Highlight video timing authority changed during preparation.');
	}
	return row as unknown as LocalAssistanceSelectedVideoSourceTimeDescriptorV1;
}

function primitiveFence(value: unknown): LocalAssistanceGuidedPrimitiveFence {
	const row = record(value, 'highlight selection fence');
	const occurrenceIds = Array.isArray(row.occurrenceIds)
		? row.occurrenceIds.map((id) => String(id)) : [];
	if (occurrenceIds.length < 1) throw new TypeError('Highlight occurrence authority is unavailable.');
	return Object.freeze({ projectId: identifier(row.projectId, 'project'),
		schemaVersion: integer(row.schemaVersion, 1, 'project schema'),
		revision: integer(row.revision, 0, 'project revision'),
		sequenceId: identifier(row.sequenceId, 'sequence'),
		occurrenceIds: Object.freeze(occurrenceIds), sourceId: identifier(row.sourceId, 'source'),
		sourceSha256: digest(row.sourceSha256),
		sourceStartFrame: integer(row.sourceStartFrame, 0, 'source start'),
		sourceEndFrame: integer(row.sourceEndFrame, 1, 'source end'),
		linkMembershipSha256: digest(row.linkMembershipSha256),
		timingAuthoritySha256: digest(row.timingAuthoritySha256) });
}

function jsonInput(
	value: unknown,
	mediaType: string,
	fence: LocalAssistanceGuidedPrimitiveFence,
): LocalAssistanceGuidedExternalInput {
	const bytes = new Blob([JSON.stringify(value)], { type: mediaType });
	if (bytes.size < 2 || bytes.size > MAXIMUM_SIGNAL_BYTES) {
		throw new RangeError('Highlight signal body exceeds its custody bound.');
	}
	return Object.freeze({ mediaType, bytes, fence });
}

function records(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => (
		Boolean(item) && typeof item === 'object' && !Array.isArray(item)
	)) : [];
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		throw new TypeError(`The ${label} must be a record.`);
	}
	return value as Record<string, unknown>;
}

function identifier(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 256) {
		throw new TypeError(`The highlight ${label} ID is invalid.`);
	}
	return value;
}

function digest(value: unknown): string {
	if (typeof value !== 'string' || !SHA256.test(value)) {
		throw new TypeError('The highlight digest authority is invalid.');
	}
	return value;
}

function integer(value: unknown, minimum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum) {
		throw new RangeError(`The highlight ${label} is invalid.`);
	}
	return Number(value);
}

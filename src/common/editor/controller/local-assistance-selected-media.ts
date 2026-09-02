/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact selected-occurrence custody for desktop local-assistance preparation. */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import { compareCodeUnits } from '../code-unit-order.ts';
import {
	normalizeAssistanceOperation,
	type AssistanceOperation,
} from '../assistance/operation.ts';
import {
	validateAssistanceSelectionFence,
	type AssistanceSelectionFence,
} from '../assistance/proposal-session.ts';
import {
	PROJECT_SCHEMA_VERSION,
	readProjectSchemaIdentity,
} from '../project-schema-identity.ts';
import {
	createLocalAssistanceAudioWaveFromChunks,
	LOCAL_ASSISTANCE_PREPARATION_CHUNK_FRAMES,
} from './local-assistance-audio-preparation.ts';
import { localAssistanceAudioWaveGeometry } from './local-assistance-audio-geometry.ts';

const MAXIMUM_OUTPUT_BYTES = 64 * 1024 * 1024;
const TEXT_ENCODER = new TextEncoder();
const SHA256 = /^[a-f\d]{64}$/u;

const AUDIO_OPERATIONS = Object.freeze([
	'voice-activity-detection',
	'speech-recognition',
	'word-alignment',
	'speaker-diarization',
	'speech-enhancement',
	'dereverberation',
	'source-separation',
	'audio-tagging',
	'beat-tracking',
] as const satisfies readonly AssistanceOperation[]);
const AUDIO_OPERATION_SET = new Set<AssistanceOperation>(AUDIO_OPERATIONS);

type AudioOperation = typeof AUDIO_OPERATIONS[number];
type DataRecord = Readonly<Record<string, unknown>>;

interface SelectedMediaProject extends DataRecord {
	readonly id: string;
	readonly schemaFamily: 'soundscaper' | 'framescaper';
	readonly schemaVersion: number;
	readonly revision: number;
	readonly sampleRate: number;
	readonly primarySequenceId: string;
	readonly selection?: DataRecord | null;
	readonly sources: readonly DataRecord[];
	readonly clips: readonly DataRecord[];
	readonly tracks: readonly DataRecord[];
}

export interface LocalAssistanceSelectedMediaPreparationDependencies {
	readonly getProject: () => unknown;
	readonly getSelectedClipId: () => string | null;
	readonly captureProject: () => unknown;
	readonly assertProject: (token: unknown) => void;
	readonly renderDryTrackRange: (
		trackId: string,
		startFrame: number,
		endFrame: number,
		requestedChannelCount: null,
		requestedClipIds: readonly string[],
		signal?: AbortSignal,
	) => Promise<readonly Float32Array[]>;
	readonly acceptValidatedResult?: (request: unknown) => Promise<void>;
}

export interface LocalAssistanceSelectedMediaInventory {
	readonly sources: readonly Readonly<{
		sourceId: string;
		label: string;
		mediaKind: 'audio';
		operations: readonly AudioOperation[];
	}>[];
}

export interface LocalAssistanceSelectedMediaPrepared {
	readonly sourceId: string;
	readonly operation: AudioOperation;
	readonly selectionFence: AssistanceSelectionFence;
	readonly inputs: readonly Readonly<{
		role: 'audio';
		mediaType: 'audio/wav';
		bytes: Blob;
	}>[];
	readonly outputs: readonly Readonly<{
		readonly slotId?: 'enhanced-audio' | 'dereverberated-audio' | 'dialogue' | 'music' | 'effects';
		role: string;
		mediaType: string;
		maximumByteLength: number;
	}>[];
}

export interface LocalAssistanceSelectedMediaPreparation {
	listSelectedMedia(): Promise<LocalAssistanceSelectedMediaInventory>;
	prepareSelectedMedia(request: Readonly<{
		sourceId: string;
		operation: AssistanceOperation;
		signal?: AbortSignal;
	}>): Promise<LocalAssistanceSelectedMediaPrepared>;
	acceptValidatedResult?(request: unknown): Promise<void>;
}

export interface LocalAssistanceSelectedMediaAuthority {
	readonly project: SelectedMediaProject;
	readonly source: DataRecord;
	readonly clip: DataRecord;
	readonly track: DataRecord;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly sourceStartFrame: number;
	readonly sourceEndFrame: number;
	readonly fence: AssistanceSelectionFence;
}

export function createLocalAssistanceSelectedMediaPreparation(
	dependencies: LocalAssistanceSelectedMediaPreparationDependencies,
): Readonly<LocalAssistanceSelectedMediaPreparation> {
	if (!dependencies || typeof dependencies !== 'object'
		|| typeof dependencies.getProject !== 'function'
		|| typeof dependencies.getSelectedClipId !== 'function'
		|| typeof dependencies.captureProject !== 'function'
		|| typeof dependencies.assertProject !== 'function'
		|| typeof dependencies.renderDryTrackRange !== 'function'
		|| (dependencies.acceptValidatedResult !== undefined
			&& typeof dependencies.acceptValidatedResult !== 'function')) {
		throw new TypeError('Selected-media preparation requires its exact controller ports.');
	}

	async function listSelectedMedia(): Promise<LocalAssistanceSelectedMediaInventory> {
		let selected: LocalAssistanceSelectedMediaAuthority;
		try { selected = resolveLocalAssistanceSelectedMediaAuthority(dependencies); }
		catch { return Object.freeze({ sources: Object.freeze([]) }); }
		return Object.freeze({ sources: Object.freeze([Object.freeze({
			sourceId: text(selected.source.id, 'source id'),
			label: text(selected.clip.title ?? selected.source.name, 'selected-media label'),
			mediaKind: 'audio' as const,
			operations: AUDIO_OPERATIONS,
		})]) });
	}

	async function prepareSelectedMedia(value: Readonly<{
		sourceId: string;
		operation: AssistanceOperation;
		signal?: AbortSignal;
	}>): Promise<LocalAssistanceSelectedMediaPrepared> {
		const request = prepareRequest(value);
		request.signal?.throwIfAborted();
		if (!AUDIO_OPERATION_SET.has(request.operation)) {
			throw new RangeError('This operation has no exact selected audio input preparation.');
		}
		const token = dependencies.captureProject();
		const selected = resolveLocalAssistanceSelectedMediaAuthority(dependencies);
		if (text(selected.source.id, 'source id') !== request.sourceId) {
			throw new Error('The requested assistance source is no longer the selected occurrence.');
		}
		const trackId = text(selected.track.id, 'track id');
		const clipIds = Object.freeze([text(selected.clip.id, 'clip id')]);
		const expectedFrames = selected.endFrame - selected.startFrame;
		const firstEnd = Math.min(selected.endFrame,
			selected.startFrame + LOCAL_ASSISTANCE_PREPARATION_CHUNK_FRAMES);
		const first = await renderRange(selected.startFrame, firstEnd);
		request.signal?.throwIfAborted();
		dependencies.assertProject(token);
		async function renderRange(startFrame: number, endFrame: number) {
			const args = [trackId, startFrame, endFrame, null, clipIds] as const;
			const rendered = request.signal
				? await dependencies.renderDryTrackRange(...args, request.signal)
				: await dependencies.renderDryTrackRange(...args);
			request.signal?.throwIfAborted();
			dependencies.assertProject(token);
			return rendered;
		}
		async function* chunks(): AsyncGenerator<readonly Float32Array[]> {
			yield first;
			for (let start = firstEnd; start < selected.endFrame;
				start += LOCAL_ASSISTANCE_PREPARATION_CHUNK_FRAMES) {
				const end = Math.min(selected.endFrame,
					start + LOCAL_ASSISTANCE_PREPARATION_CHUNK_FRAMES);
				yield await renderRange(start, end);
			}
		}
		const input = await createLocalAssistanceAudioWaveFromChunks(
			request.operation as AudioOperation, chunks(), expectedFrames,
			selected.project.sampleRate, first.length, request.signal,
		);
		request.signal?.throwIfAborted();
		dependencies.assertProject(token);
		const geometry = localAssistanceAudioWaveGeometry(
			request.operation as AudioOperation, expectedFrames,
			selected.project.sampleRate, first.length,
		);
		return Object.freeze({
			sourceId: request.sourceId,
			operation: request.operation as AudioOperation,
			selectionFence: selected.fence,
			inputs: Object.freeze([Object.freeze({ role: 'audio' as const,
				mediaType: 'audio/wav' as const, bytes: input })]),
			outputs: outputsFor(request.operation as AudioOperation, geometry.byteLength),
		});
	}

	return Object.freeze({
		listSelectedMedia,
		prepareSelectedMedia,
		...(dependencies.acceptValidatedResult === undefined ? {} : {
			acceptValidatedResult: (request: unknown) => dependencies.acceptValidatedResult!(request),
		}),
	});
}

export function resolveLocalAssistanceSelectedMediaAuthority(
	dependencies: LocalAssistanceSelectedMediaPreparationDependencies,
): LocalAssistanceSelectedMediaAuthority {
	const project = selectedProject(dependencies.getProject());
	const clipId = dependencies.getSelectedClipId();
	if (typeof clipId !== 'string' || clipId === '') {
		throw new Error('Local assistance requires one selected audio occurrence.');
	}
	const clip = project.clips.find((candidate) => candidate.id === clipId);
	if (!clip || clip.kind !== 'audio') {
		throw new Error('Local assistance requires one selected audio occurrence.');
	}
	const owners = project.tracks.filter((track) => track.type === 'audio'
		&& Array.isArray(track.clipIds) && track.clipIds.includes(clipId));
	if (owners.length !== 1) throw new Error('The selected audio occurrence has ambiguous track ownership.');
	const track = owners[0]!;
	const sourceId = text(clip.sourceId, 'clip source id');
	const source = project.sources.find((candidate) => candidate.id === sourceId);
	if (!source || source.kind !== 'audio') throw new Error('The selected audio source is unavailable.');
	assertIdentityTiming(clip, source, project.sampleRate);
	const clipStart = integer(clip.timelineStartFrame, 0, 'clip timeline start');
	const duration = integer(clip.durationFrames, 1, 'clip duration');
	const clipEnd = safeAdd(clipStart, duration, 'clip timeline end');
	const selection = project.selection;
	const selectionStart = selection && Number(selection.endFrame) > Number(selection.startFrame)
		? integer(selection.startFrame, 0, 'selection start') : clipStart;
	const selectionEnd = selection && Number(selection.endFrame) > Number(selection.startFrame)
		? integer(selection.endFrame, 1, 'selection end') : clipEnd;
	if (selectionStart < clipStart || selectionEnd > clipEnd || selectionEnd <= selectionStart) {
		throw new RangeError('The assistance selection must remain inside the selected occurrence.');
	}
	const selectionFrames = selectionEnd - selectionStart;
	const sourceStart = safeAdd(integer(clip.sourceStartFrame, 0, 'clip source start'),
		selectionStart - clipStart, 'selected source start');
	const sourceEnd = safeAdd(sourceStart, selectionFrames, 'selected source end');
	if (sourceEnd > integer(source.frameCount, 1, 'source frame count')) {
		throw new RangeError('The assistance selection exceeds its authenticated source.');
	}
	const fence = createLocalAssistanceSelectionFence(project, clip, source, track,
		selectionStart, selectionEnd, sourceStart, sourceEnd);
	return Object.freeze({ project, source, clip, track, startFrame: selectionStart,
		endFrame: selectionEnd, sourceStartFrame: sourceStart, sourceEndFrame: sourceEnd, fence });
}

export function createLocalAssistanceSelectionFence(
	project: SelectedMediaProject,
	clip: DataRecord,
	source: DataRecord,
	track: DataRecord,
	startFrame: number,
	endFrame: number,
	sourceStartFrame: number,
	sourceEndFrame: number,
): AssistanceSelectionFence {
	const linkId = typeof clip.avLinkId === 'string' && clip.avLinkId !== '' ? clip.avLinkId : null;
	const members = project.clips.filter((candidate) => candidate.id === clip.id
		|| (linkId !== null && candidate.avLinkId === linkId)).map((candidate) => Object.freeze({
		id: text(candidate.id, 'linked occurrence id'),
		kind: candidate.kind,
		sourceId: candidate.sourceId,
		avLinkId: candidate.avLinkId ?? null,
		trackId: project.tracks.find((owner) => Array.isArray(owner.clipIds)
			&& owner.clipIds.includes(candidate.id))?.id ?? null,
	})).sort((left, right) => compareCodeUnits(left.id, right.id));
	const sequenceId = text(clip.sequenceId ?? project.primarySequenceId, 'sequence id');
	return validateAssistanceSelectionFence({
		projectId: project.id,
		schemaFamily: project.schemaFamily,
		schemaVersion: project.schemaVersion,
		revision: project.revision,
		sequenceId,
		occurrenceIds: members.map(({ id }) => id),
		sourceId: text(source.id, 'source id'),
		sourceSha256: digest(source.contentSha256, 'source digest'),
		sourceStartFrame,
		sourceEndFrame,
		linkMembershipSha256: digestValue(members),
		timingAuthoritySha256: digestValue({
			sequenceId, trackId: track.id, clip,
			timelineRange: { startFrame, endFrame },
			sourceRange: { startFrame: sourceStartFrame, endFrame: sourceEndFrame },
		}),
	});
}

function outputsFor(operation: AudioOperation, audioWaveByteLength: number): readonly Readonly<{
	slotId?: 'enhanced-audio' | 'dereverberated-audio' | 'dialogue' | 'music' | 'effects';
	role: string; mediaType: string; maximumByteLength: number;
}>[] {
	const values = {
		'voice-activity-detection': ['voice-activity', 'application/vnd.soundscaper.voice-activity+json'],
		'speech-recognition': ['transcript', 'application/vnd.soundscaper.transcript+json'],
		'word-alignment': ['word-alignment', 'application/vnd.soundscaper.word-alignment+json'],
		'speaker-diarization': ['speaker-turns', 'application/vnd.soundscaper.speaker-turns+json'],
		'speech-enhancement': ['enhanced-audio', 'audio/wav'],
		'dereverberation': ['enhanced-audio', 'audio/wav'],
		'source-separation': ['separated-audio', 'audio/wav'],
		'audio-tagging': ['audio-tags', 'application/vnd.soundscaper.audio-tags+json'],
		'beat-tracking': ['beat-grid', 'application/vnd.soundscaper.beat-grid+json'],
	} satisfies Readonly<Record<AudioOperation, readonly [string, string]>>;
	const [role, mediaType] = values[operation];
	const slots = operation === 'speech-enhancement'
		? ['enhanced-audio'] as const
		: operation === 'dereverberation' ? ['dereverberated-audio'] as const
			: operation === 'source-separation' ? ['dialogue', 'music', 'effects'] as const : null;
	return Object.freeze((slots ?? [null]).map((slotId) => Object.freeze({
		...(slotId === null ? {} : { slotId }), role, mediaType,
		maximumByteLength: mediaType === 'audio/wav' ? audioWaveByteLength : MAXIMUM_OUTPUT_BYTES,
	})));
}

function prepareRequest(value: unknown): Readonly<{
	sourceId: string; operation: AssistanceOperation; signal?: AbortSignal;
}> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Reflect.ownKeys(value).length < 2 || Reflect.ownKeys(value).length > 3
		|| !Object.hasOwn(value, 'sourceId') || !Object.hasOwn(value, 'operation')
		|| (Reflect.ownKeys(value).length === 3 && !Object.hasOwn(value, 'signal'))) {
		throw new TypeError('Selected-media preparation requires its exact request.');
	}
	const record = value as DataRecord;
	const signal = record.signal;
	if (signal !== undefined && !(signal instanceof AbortSignal)) {
		throw new TypeError('Selected-media preparation requires a valid cancellation signal.');
	}
	return Object.freeze({ sourceId: text(record.sourceId, 'requested source id'),
		operation: normalizeAssistanceOperation(record.operation),
		...(signal ? { signal } : {}),
	});
}

function selectedProject(value: unknown): SelectedMediaProject {
	const identity = readProjectSchemaIdentity(value);
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Local assistance requires an active project.');
	}
	const project = value as Partial<SelectedMediaProject>;
	if (identity.schemaVersion !== PROJECT_SCHEMA_VERSION) {
		throw new RangeError('Local assistance requires the current project schema.');
	}
	if (!Array.isArray(project.sources) || !Array.isArray(project.clips)
		|| !Array.isArray(project.tracks)) {
		throw new TypeError('The active project has no bounded media inventory.');
	}
	return {
		...(project as SelectedMediaProject),
		id: text(project.id, 'project id'),
		schemaFamily: identity.schemaFamily,
		schemaVersion: PROJECT_SCHEMA_VERSION,
		revision: integer(project.revision, 0, 'project revision'),
		sampleRate: integer(project.sampleRate, 1, 'project sample rate'),
		primarySequenceId: text(project.primarySequenceId, 'primary sequence id'),
	};
}

function assertIdentityTiming(clip: DataRecord, source: DataRecord, sampleRate: number): void {
	if (clip.reversed !== false || clip.speedRatio !== 1 || clip.pitchCents !== 0
		|| clip.stretchToTempo !== false || clip.anchor !== 'sample' || clip.warpMap !== null
		|| clip.sourceDurationFrames !== clip.durationFrames
		|| source.sampleRate !== sampleRate) {
		throw new Error('Selected-media preparation currently requires forward identity timing.');
	}
}

function digestValue(value: unknown): string {
	return bytesToHex(sha256(TEXT_ENCODER.encode(canonicalJson(value))));
}

function canonicalJson(value: unknown): string {
	if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
	if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError('An assistance authority digest requires canonical JSON data.');
	}
	const record = value as Record<string, unknown>;
	return `{${Object.keys(record).sort().map((key) => (
		`${JSON.stringify(key)}:${canonicalJson(record[key])}`
	)).join(',')}}`;
}

function text(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 256) {
		throw new TypeError(`The assistance ${label} is invalid.`);
	}
	return value;
}

function digest(value: unknown, label: string): string {
	if (typeof value !== 'string' || !SHA256.test(value)) {
		throw new TypeError(`The assistance ${label} is invalid.`);
	}
	return value;
}

function integer(value: unknown, minimum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum) {
		throw new RangeError(`The assistance ${label} is invalid.`);
	}
	return Number(value);
}

function safeAdd(left: number, right: number, label: string): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw new RangeError(`The assistance ${label} is invalid.`);
	return result;
}

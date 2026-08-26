/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact selected-occurrence custody for desktop local-assistance preparation. */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
	normalizeAssistanceOperation,
	type AssistanceOperation,
} from '../assistance/operation.ts';
import {
	validateAssistanceSelectionFence,
	type AssistanceSelectionFence,
} from '../assistance/proposal-session.ts';
import { createStreamingWindowedSincResampler } from '../resample.js';
import { scaleSampleFrame } from '../timeline-time.ts';
import { encodeWav } from '../wav.js';

const TARGET_SAMPLE_RATE = 16_000;
const MAXIMUM_SELECTION_SECONDS = 10 * 60;
const MAXIMUM_OUTPUT_BYTES = 64 * 1024 * 1024;
const PREPARATION_CHUNK_FRAMES = 65_536;
const TEXT_ENCODER = new TextEncoder();
const SHA256 = /^[a-f\d]{64}$/u;

const AUDIO_OPERATIONS = Object.freeze([
	'voice-activity-detection',
	'speech-recognition',
	'speaker-diarization',
	'speech-enhancement',
	'source-separation',
	'audio-tagging',
	'beat-tracking',
] as const satisfies readonly AssistanceOperation[]);
const AUDIO_OPERATION_SET = new Set<AssistanceOperation>(AUDIO_OPERATIONS);

type AudioOperation = typeof AUDIO_OPERATIONS[number];
type DataRecord = Readonly<Record<string, unknown>>;

interface SelectedMediaProject extends DataRecord {
	readonly id: string;
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
		const renderArgs = [
			text(selected.track.id, 'track id'), selected.startFrame, selected.endFrame,
			null, Object.freeze([text(selected.clip.id, 'clip id')]),
		] as const;
		const channels = request.signal
			? await dependencies.renderDryTrackRange(...renderArgs, request.signal)
			: await dependencies.renderDryTrackRange(...renderArgs);
		request.signal?.throwIfAborted();
		dependencies.assertProject(token);
		const input = await createSpeechWave(channels, selected.endFrame - selected.startFrame,
			selected.project.sampleRate, request.signal);
		request.signal?.throwIfAborted();
		dependencies.assertProject(token);
		return Object.freeze({
			sourceId: request.sourceId,
			operation: request.operation as AudioOperation,
			selectionFence: selected.fence,
			inputs: Object.freeze([Object.freeze({ role: 'audio' as const,
				mediaType: 'audio/wav' as const, bytes: input })]),
			outputs: Object.freeze([outputFor(request.operation as AudioOperation)]),
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
	if (selectionFrames > project.sampleRate * MAXIMUM_SELECTION_SECONDS) {
		throw new RangeError('One local-assistance audio selection cannot exceed ten minutes.');
	}
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
	})).sort((left, right) => left.id.localeCompare(right.id));
	const sequenceId = text(clip.sequenceId ?? project.primarySequenceId, 'sequence id');
	return validateAssistanceSelectionFence({
		projectId: project.id,
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

async function createSpeechWave(
	channelsValue: readonly Float32Array[],
	expectedFrames: number,
	inputSampleRate: number,
	signal?: AbortSignal,
): Promise<Blob> {
	if (!Array.isArray(channelsValue) || channelsValue.length < 1 || channelsValue.length > 64
		|| channelsValue.some((channel) => !(channel instanceof Float32Array)
			|| channel.length !== expectedFrames)) {
		throw new Error('The selected audio render returned inexact channel geometry.');
	}
	const mono = new Float32Array(expectedFrames);
	const scale = 1 / channelsValue.length;
	for (let start = 0; start < expectedFrames; start += PREPARATION_CHUNK_FRAMES) {
		signal?.throwIfAborted();
		const end = Math.min(expectedFrames, start + PREPARATION_CHUNK_FRAMES);
		for (let frame = start; frame < end; frame += 1) {
			let sample = 0;
			for (const channel of channelsValue) sample += channel[frame]!;
			mono[frame] = sample * scale;
		}
		if (end < expectedFrames) await yieldForCancellation(signal);
	}
	const outputFrames = Number(scaleSampleFrame(expectedFrames, inputSampleRate,
		TARGET_SAMPLE_RATE, 'point'));
	const resampler = createStreamingWindowedSincResampler(
		inputSampleRate, TARGET_SAMPLE_RATE, 1,
	) as unknown as Readonly<{
		push(channels: Float32Array[]): Float32Array[];
		finish(outputFrames: number): Float32Array[];
	}>;
	const parts: Float32Array[] = [];
	for (let start = 0; start < mono.length; start += PREPARATION_CHUNK_FRAMES) {
		signal?.throwIfAborted();
		const end = Math.min(mono.length, start + PREPARATION_CHUNK_FRAMES);
		const output = resampler.push([mono.subarray(start, end)])[0];
		if (output?.length) parts.push(output);
		if (end < mono.length) await yieldForCancellation(signal);
	}
	const tail = resampler.finish(outputFrames)[0];
	if (tail?.length) parts.push(tail);
	const resampled = new Float32Array(outputFrames);
	let written = 0;
	for (const part of parts) {
		if (written + part.length > resampled.length) {
			throw new Error('The selected audio resampler exceeded its exact geometry.');
		}
		resampled.set(part, written);
		written += part.length;
	}
	if (written !== outputFrames) {
		throw new Error('The selected audio resampler returned inexact geometry.');
	}
	signal?.throwIfAborted();
	const bytes = encodeWav([resampled], {
		sampleRate: TARGET_SAMPLE_RATE, bitDepth: 32, float: true, dither: false,
	});
	signal?.throwIfAborted();
	return new Blob([bytes.slice().buffer], { type: 'audio/wav' });
}

async function yieldForCancellation(signal?: AbortSignal): Promise<void> {
	signal?.throwIfAborted();
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	signal?.throwIfAborted();
}

function outputFor(operation: AudioOperation): Readonly<{
	role: string; mediaType: string; maximumByteLength: number;
}> {
	const values = {
		'voice-activity-detection': ['voice-activity', 'application/vnd.soundscaper.voice-activity+json'],
		'speech-recognition': ['transcript', 'application/vnd.soundscaper.transcript+json'],
		'speaker-diarization': ['speaker-turns', 'application/vnd.soundscaper.speaker-turns+json'],
		'speech-enhancement': ['enhanced-audio', 'audio/wav'],
		'source-separation': ['separated-audio', 'audio/wav'],
		'audio-tagging': ['audio-tags', 'application/vnd.soundscaper.audio-tags+json'],
		'beat-tracking': ['beat-grid', 'application/vnd.soundscaper.beat-grid+json'],
	} satisfies Readonly<Record<AudioOperation, readonly [string, string]>>;
	const [role, mediaType] = values[operation];
	return Object.freeze({ role, mediaType, maximumByteLength: MAXIMUM_OUTPUT_BYTES });
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
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Local assistance requires an active project.');
	}
	const project = value as Partial<SelectedMediaProject>;
	if (!Array.isArray(project.sources) || !Array.isArray(project.clips)
		|| !Array.isArray(project.tracks)) {
		throw new TypeError('The active project has no bounded media inventory.');
	}
	return {
		...(project as SelectedMediaProject),
		id: text(project.id, 'project id'),
		schemaVersion: integer(project.schemaVersion, 1, 'project schema version'),
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

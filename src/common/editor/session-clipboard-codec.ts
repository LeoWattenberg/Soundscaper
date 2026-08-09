/* SPDX-License-Identifier: AGPL-3.0-only */

import { createClipboardDescriptor } from './commands/clipboard-runtime.js';
import type { AudioEditorClipboard } from './commands/protocol.ts';
import {
	clone as cloneSessionValue,
	nonEmptyString,
	nonNegativeInteger,
	normalizeProject,
	positiveInteger,
} from './session-history.js';

export const AUDIO_EDITOR_SESSION_CLIPBOARD_SCHEMA_VERSION = 1;

type DataRecord = Record<string, unknown>;

export interface AudioEditorSessionClipboardSource extends Readonly<Record<string, unknown>> {
	readonly id: string;
}

export interface AudioEditorSessionClipboard {
	readonly schemaVersion: typeof AUDIO_EDITOR_SESSION_CLIPBOARD_SCHEMA_VERSION;
	readonly originProjectId: string;
	readonly descriptor: AudioEditorClipboard;
	readonly sources: readonly AudioEditorSessionClipboardSource[];
}

export interface CreateAudioEditorSessionClipboardOptions {
	readonly descriptor?: unknown;
	readonly startFrame?: unknown;
	readonly endFrame?: unknown;
	readonly trackIds?: readonly string[] | null;
}

interface SessionClipboardProject extends DataRecord {
	readonly id: string;
	readonly sources: readonly AudioEditorSessionClipboardSource[];
	readonly clips: readonly DataRecord[];
	readonly tracks: readonly DataRecord[];
}

/** Collect the media roots retained by one already-admitted clipboard descriptor. */
export function collectAudioEditorClipboardSourceIds(
	descriptor: AudioEditorClipboard | null | undefined,
): readonly string[] {
	const ids = new Set<string>();
	for (const track of descriptor?.tracks || []) {
		for (const clip of track?.clips || []) {
			if (typeof clip?.sourceId === 'string' && clip.sourceId) ids.add(clip.sourceId);
		}
	}
	return [...ids].sort();
}

/** Validate and detach one legacy V1 or current V2 command clipboard descriptor. */
export function normalizeAudioEditorClipboardDescriptor(descriptor: unknown): AudioEditorClipboard {
	if (!descriptor || typeof descriptor !== 'object') {
		throw new TypeError('An audio editor clipboard descriptor is required.');
	}
	const candidate = descriptor as DataRecord;
	if (candidate.schemaVersion !== 1 && candidate.schemaVersion !== 2) {
		throw new RangeError(`Unsupported clipboard schema version: ${candidate.schemaVersion as string}.`);
	}
	positiveInteger(candidate.sampleRate, 'clipboard.sampleRate');
	positiveInteger(candidate.durationFrames, 'clipboard.durationFrames');
	if (!Array.isArray(candidate.tracks)) throw new TypeError('clipboard.tracks must be an array.');
	const laneGroups = new Map<string, Array<{ index: number; type: 'audio' | 'video' }>>();
	const avLinks = new Map<string, Array<{
		kind: 'audio' | 'video';
		offsetFrame: unknown;
		durationFrames: unknown;
		laneGroupId: unknown;
	}>>();
	for (const [trackIndex, trackValue] of candidate.tracks.entries()) {
		const track = trackValue as DataRecord | null | undefined;
		nonEmptyString(track?.sourceTrackId, `clipboard.tracks[${String(trackIndex)}].sourceTrackId`);
		if (!Array.isArray(track?.clips)) {
			throw new TypeError(`clipboard.tracks[${String(trackIndex)}].clips must be an array.`);
		}
		const sourceTrackType = candidate.schemaVersion === 2 ? track.sourceTrackType : 'audio';
		if (!['audio', 'video'].includes(sourceTrackType as string)) {
			throw new RangeError(`clipboard.tracks[${String(trackIndex)}].sourceTrackType must be audio or video.`);
		}
		const admittedSourceTrackType = sourceTrackType as 'audio' | 'video';
		if (candidate.schemaVersion === 2 && track.sourceLaneGroupId != null) {
			const laneGroupId = nonEmptyString(
				track.sourceLaneGroupId,
				`clipboard.tracks[${String(trackIndex)}].sourceLaneGroupId`,
			) as string;
			const entries = laneGroups.get(laneGroupId) || [];
			entries.push({ index: trackIndex, type: admittedSourceTrackType });
			laneGroups.set(laneGroupId, entries);
		}
		for (const [clipIndex, clipValue] of track.clips.entries()) {
			const clip = clipValue as DataRecord;
			const clipName = `clipboard.tracks[${String(trackIndex)}].clips[${String(clipIndex)}]`;
			nonEmptyString(clip?.key, `${clipName}.key`);
			nonEmptyString(clip?.sourceId, `${clipName}.sourceId`);
			nonNegativeInteger(clip?.offsetFrame, `${clipName}.offsetFrame`);
			nonNegativeInteger(clip?.sourceStartFrame, `${clipName}.sourceStartFrame`);
			positiveInteger(clip?.durationFrames, `${clipName}.durationFrames`);
			if (candidate.schemaVersion === 2) {
				if (!['audio', 'video'].includes(clip?.kind as string)) {
					throw new RangeError(`${clipName}.kind must be audio or video.`);
				}
				if (clip.kind !== admittedSourceTrackType) {
					throw new RangeError(`clipboard.tracks[${String(trackIndex)}] cannot contain a ${clip.kind} clip.`);
				}
				if (clip.groupId != null) nonEmptyString(clip.groupId, `${clipName}.groupId`);
				if (clip.avLinkId != null) {
					const avLinkId = nonEmptyString(clip.avLinkId, `${clipName}.avLinkId`) as string;
					const linked = avLinks.get(avLinkId) || [];
					linked.push({
						kind: clip.kind as 'audio' | 'video',
						offsetFrame: clip.offsetFrame,
						durationFrames: clip.durationFrames,
						laneGroupId: track.sourceLaneGroupId || null,
					});
					avLinks.set(avLinkId, linked);
				}
			}
		}
	}
	for (const [laneGroupId, tracks] of laneGroups) {
		if (
			tracks.length !== 2
			|| tracks[0]?.type !== 'video'
			|| tracks[1]?.type !== 'audio'
			|| tracks[1].index !== tracks[0].index + 1
		) {
			throw new RangeError(`Clipboard media lane group ${laneGroupId} must contain one adjacent video/audio track pair.`);
		}
	}
	for (const [avLinkId, linked] of avLinks) {
		if (
			linked.length !== 2
			|| linked[0]?.kind !== 'video'
			|| linked[1]?.kind !== 'audio'
			|| linked[0].offsetFrame !== linked[1].offsetFrame
			|| linked[0].durationFrames !== linked[1].durationFrames
			|| !linked[0].laneGroupId
			|| linked[0].laneGroupId !== linked[1].laneGroupId
		) {
			throw new RangeError(`Clipboard A/V link ${avLinkId} must contain one aligned video/audio pair.`);
		}
	}
	return clone<AudioEditorClipboard>(candidate as unknown as AudioEditorClipboard);
}

/** Attach source metadata so a clipboard can outlive and cross its origin tab. */
export function createAudioEditorSessionClipboard(
	project: unknown,
	options: CreateAudioEditorSessionClipboardOptions = {},
): AudioEditorSessionClipboard {
	const normalizedProject = normalizeProject(project) as SessionClipboardProject;
	const defaultTrackIds = normalizedProject.tracks
		.filter((track) => track.type !== 'label' && Array.isArray(track.clipIds))
		.map((track) => track.id as string);
	const generatedDescriptor = options.descriptor || createClipboardDescriptor(normalizedProject, {
		startFrame: options.startFrame,
		endFrame: options.endFrame,
		trackIds: options.trackIds || defaultTrackIds,
	});
	const descriptor = normalizeAudioEditorClipboardDescriptor(generatedDescriptor);
	const sourceIds = collectAudioEditorClipboardSourceIds(descriptor);
	const sourceById = new Map(normalizedProject.sources.map((source) => [source.id, source]));
	const sources = sourceIds.map((sourceId) => {
		const source = sourceById.get(sourceId);
		if (!source) {
			const inputProject = project as DataRecord;
			throw new ReferenceError(`Clipboard source ${sourceId} is missing from project ${inputProject.id as string}.`);
		}
		return clone(source);
	});
	return {
		schemaVersion: AUDIO_EDITOR_SESSION_CLIPBOARD_SCHEMA_VERSION,
		originProjectId: normalizedProject.id,
		descriptor,
		sources,
	};
}

/** Validate a persisted session wrapper and retain only descriptor-owned source metadata. */
export function normalizeAudioEditorSessionClipboard(value: unknown): AudioEditorSessionClipboard {
	if (!value || typeof value !== 'object') throw new TypeError('A session clipboard is required.');
	const candidate = value as DataRecord;
	if (candidate.schemaVersion !== AUDIO_EDITOR_SESSION_CLIPBOARD_SCHEMA_VERSION) {
		throw new RangeError(`Unsupported session clipboard schema version: ${candidate.schemaVersion as string}.`);
	}
	nonEmptyString(candidate.originProjectId, 'session clipboard originProjectId');
	const descriptor = normalizeAudioEditorClipboardDescriptor(candidate.descriptor);
	if (!Array.isArray(candidate.sources)) throw new TypeError('Session clipboard sources must be an array.');
	const sourceIds = collectAudioEditorClipboardSourceIds(descriptor);
	const sourceById = new Map<string, AudioEditorSessionClipboardSource>();
	for (const sourceValue of candidate.sources) {
		if (!sourceValue || typeof sourceValue !== 'object') {
			throw new TypeError('Session clipboard source metadata is required.');
		}
		const source = sourceValue as DataRecord;
		const sourceId = nonEmptyString(source.id, 'session clipboard source ID') as string;
		if (sourceById.has(sourceId)) throw new RangeError(`Duplicate session clipboard source ID: ${sourceId}.`);
		sourceById.set(sourceId, clone(source) as AudioEditorSessionClipboardSource);
	}
	const sources = sourceIds.map((sourceId) => {
		const source = sourceById.get(sourceId);
		if (!source) throw new ReferenceError(`Session clipboard source metadata is missing for ${sourceId}.`);
		return source;
	});
	return {
		schemaVersion: AUDIO_EDITOR_SESSION_CLIPBOARD_SCHEMA_VERSION,
		originProjectId: candidate.originProjectId as string,
		descriptor,
		sources,
	};
}

function clone<Value>(value: Value): Value {
	return cloneSessionValue(value) as Value;
}

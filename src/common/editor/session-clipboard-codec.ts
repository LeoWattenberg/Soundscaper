/* SPDX-License-Identifier: AGPL-3.0-only */

import { createClipboardDescriptor } from './commands/clipboard-runtime.js';
import {
	collectAudioEditorClipboardSourceIds,
	normalizeAudioEditorClipboardDescriptor,
} from './commands/clipboard-codec.ts';
import type { AudioEditorClipboard } from './commands/protocol.ts';
import {
	clone as cloneSessionValue,
	nonEmptyString,
	normalizeProject,
} from './session-history.js';

export const AUDIO_EDITOR_SESSION_CLIPBOARD_SCHEMA_VERSION = 1;

export {
	collectAudioEditorClipboardSourceIds,
	normalizeAudioEditorClipboardDescriptor,
};

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

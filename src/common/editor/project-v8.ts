/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	AUDIO_EDITOR_MEDIA_KINDS as V7_MEDIA_KINDS,
	AUDIO_EDITOR_TRACK_TYPES as V7_TRACK_TYPES,
	createAudioClipV7,
	createAudioEditorProjectV7,
	createAudioSourceV7,
	createAudioTrackV7,
	createLabelTrackV7,
	createMediaSourceV7,
	createMediaTrackV7,
	createVideoClipV7,
	createVideoSourceV7,
	createVideoTrackV7,
	validateAudioEditorProjectV7,
	type AudioEditorProjectMetadataV7,
	type AudioEditorProjectV7Options,
} from './project-v7.ts';
import { normalizeVideoEffects } from './video-effects.js';

export const AUDIO_EDITOR_PROJECT_SCHEMA_VERSION = 8;
export const AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION = AUDIO_EDITOR_PROJECT_SCHEMA_VERSION;
export const AUDIO_EDITOR_MEDIA_KINDS = V7_MEDIA_KINDS;
export const AUDIO_EDITOR_TRACK_TYPES = V7_TRACK_TYPES;

export interface AudioEditorProjectV8 {
	readonly schemaVersion: 8;
	readonly id: string;
	readonly title: string;
	readonly revision: number;
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly sampleRate: number;
	readonly masterChannels: number;
	readonly metadata: AudioEditorProjectMetadataV7;
	readonly sources: readonly Readonly<Record<string, unknown>>[];
	readonly clips: readonly Readonly<Record<string, unknown>>[];
	readonly tracks: readonly Readonly<Record<string, unknown>>[];
	readonly projectBin: Readonly<Record<string, unknown>> & {
		readonly clips: readonly Readonly<Record<string, unknown>>[];
	};
	readonly [extension: string]: unknown;
}

export type AudioEditorProjectV8Options = AudioEditorProjectV7Options;

function clone<Value>(value: Value): Value {
	if (value === undefined || value === null) return value;
	if (typeof structuredClone === 'function') return structuredClone(value);
	return JSON.parse(JSON.stringify(value)) as Value;
}

function objectValue(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as Record<string, unknown>;
}

export const createAudioSourceV8 = createAudioSourceV7;
export const createVideoSourceV8 = createVideoSourceV7;
export const createMediaSourceV8 = createMediaSourceV7;
export const createAudioClipV8 = createAudioClipV7;

export function createVideoClipV8(options: Record<string, unknown> = {}): Record<string, unknown> {
	const legacy = createVideoClipV7({ ...options, videoEffects: [] });
	return {
		...legacy,
		videoEffects: normalizeVideoEffects(
			Object.hasOwn(options, 'videoEffects') ? options.videoEffects : [],
			'clip.videoEffects',
		),
	};
}

export function createMediaClipV8(options: Record<string, unknown> = {}): Record<string, unknown> {
	return options.kind === 'video' ? createVideoClipV8(options) : createAudioClipV8(options);
}

export const createAudioTrackV8 = createAudioTrackV7;
export const createVideoTrackV8 = createVideoTrackV7;
export const createLabelTrackV8 = createLabelTrackV7;
export const createMediaTrackV8 = createMediaTrackV7;

export function createProjectBinV8(
	value: Record<string, unknown> = {},
): AudioEditorProjectV8['projectBin'] {
	const clips = value.clips;
	if (clips != null && !Array.isArray(clips)) throw new TypeError('project.projectBin.clips must be an array.');
	return {
		...clone(value),
		clips: (clips || []).map((candidate) => {
			const clip = createMediaClipV8(candidate as Record<string, unknown>);
			return { ...clip, binItemId: clip.binItemId || clip.id };
		}),
	};
}

export function createAudioEditorProjectV8(options: AudioEditorProjectV8Options = {}): AudioEditorProjectV8 {
	const candidate = options as Record<string, unknown>;
	const clips = Array.isArray(candidate.clips) ? candidate.clips : [];
	const projectBin = candidate.projectBin == null
		? {}
		: objectValue(candidate.projectBin, 'project.projectBin');
	const base = createAudioEditorProjectV7({
		...options,
		clips: clips.map((clip) => ({ ...objectValue(clip, 'clip'), videoEffects: [] })),
		projectBin: {
			...projectBin,
			clips: Array.isArray(projectBin.clips)
				? projectBin.clips.map((clip) => ({ ...objectValue(clip, 'projectBin clip'), videoEffects: [] }))
				: [],
		},
	});
	return {
		...base,
		schemaVersion: AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
		clips: clips.map((clip) => createMediaClipV8(objectValue(clip, 'clip'))),
		projectBin: createProjectBinV8(projectBin),
	};
}

export function cloneAudioEditorProjectV8(project: AudioEditorProjectV8): AudioEditorProjectV8 {
	return clone(project);
}

export function validateAudioEditorProjectV8(project: unknown): project is AudioEditorProjectV8 {
	const candidate = objectValue(project, 'project');
	if (candidate.schemaVersion !== AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION) {
		throw new RangeError(`Unsupported audio editor schema version: ${String(candidate.schemaVersion)}.`);
	}
	const clips = Array.isArray(candidate.clips) ? candidate.clips : [];
	const projectBin = objectValue(candidate.projectBin, 'project.projectBin');
	const binClips = Array.isArray(projectBin.clips) ? projectBin.clips : [];
	validateAudioEditorProjectV7({
		...candidate,
		schemaVersion: 7,
		clips: clips.map((clip) => ({ ...objectValue(clip, 'clip'), videoEffects: [] })),
		projectBin: {
			...projectBin,
			clips: binClips.map((clip) => ({ ...objectValue(clip, 'projectBin clip'), videoEffects: [] })),
		},
	});
	for (const clip of [...clips, ...binClips]) {
		const value = objectValue(clip, 'clip');
		if (value.kind !== 'video') continue;
		normalizeVideoEffects(value.videoEffects, `Video clip ${String(value.id)}.videoEffects`);
	}
	return true;
}

export function loadAudioEditorProjectV8(value: unknown): {
	project: AudioEditorProjectV8 | Record<string, unknown>;
	readOnly: boolean;
	reason: 'newer-schema' | null;
} {
	const candidate = objectValue(value, 'saved project');
	const schemaVersion = Number(candidate.schemaVersion);
	if (schemaVersion > AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION) {
		return { project: clone(candidate), readOnly: true, reason: 'newer-schema' };
	}
	validateAudioEditorProjectV8(candidate);
	const project = createAudioEditorProjectV8({
		...candidate,
		now: candidate.createdAt,
	} as AudioEditorProjectV8Options);
	validateAudioEditorProjectV8(project);
	return { project, readOnly: false, reason: null };
}

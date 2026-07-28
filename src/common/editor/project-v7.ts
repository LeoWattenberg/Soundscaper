/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	AUDIO_EDITOR_MEDIA_KINDS as V6_MEDIA_KINDS,
	AUDIO_EDITOR_TRACK_TYPES as V6_TRACK_TYPES,
	createAudioClipV6,
	createAudioEditorProjectV6,
	createAudioSourceV6,
	createAudioTrackV6,
	createLabelTrackV6,
	createMediaClipV6,
	createMediaSourceV6,
	createMediaTrackV6,
	createProjectBinV6,
	createVideoClipV6,
	createVideoSourceV6,
	createVideoTrackV6,
	validateAudioEditorProjectV6,
	type AudioEditorProjectMetadataV6,
	type AudioEditorProjectV6Options,
} from './project-v6.ts';
import {
	normalizeAdmProjectMetadata,
	validateAdmProjectMetadata,
	type AdmProjectMetadata,
	type AdmProjectMetadataInput,
} from './adm-project-metadata.ts';

export {
	normalizeAdmProjectMetadata,
	type AdmProjectMetadata,
	type AdmProjectMetadataInput,
} from './adm-project-metadata.ts';

export const AUDIO_EDITOR_PROJECT_SCHEMA_VERSION = 7;
export const AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION = AUDIO_EDITOR_PROJECT_SCHEMA_VERSION;
export const AUDIO_EDITOR_MEDIA_KINDS = V6_MEDIA_KINDS;
export const AUDIO_EDITOR_TRACK_TYPES = V6_TRACK_TYPES;

export interface AudioEditorProjectMetadataV7 extends AudioEditorProjectMetadataV6 {
	readonly adm: AdmProjectMetadata | null;
}

export interface AudioEditorProjectV7 {
	readonly schemaVersion: 7;
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

export interface AudioEditorProjectV7Options extends Omit<AudioEditorProjectV6Options, 'metadata'> {
	readonly metadata?: AudioEditorProjectV6Options['metadata'] & {
		readonly adm?: AdmProjectMetadataInput | null;
	};
}

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

export const createAudioSourceV7 = createAudioSourceV6;
export const createVideoSourceV7 = createVideoSourceV6;
export const createMediaSourceV7 = createMediaSourceV6;
export const createAudioClipV7 = createAudioClipV6;
export const createVideoClipV7 = createVideoClipV6;
export const createMediaClipV7 = createMediaClipV6;
export const createAudioTrackV7 = createAudioTrackV6;
export const createVideoTrackV7 = createVideoTrackV6;
export const createLabelTrackV7 = createLabelTrackV6;
export const createMediaTrackV7 = createMediaTrackV6;
export const createProjectBinV7 = createProjectBinV6;

export function createAudioEditorProjectV7(options: AudioEditorProjectV7Options = {}): AudioEditorProjectV7 {
	const project = createAudioEditorProjectV6(options);
	const inputAdm = options.metadata?.adm;
	return {
		...project,
		schemaVersion: AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
		metadata: {
			...project.metadata,
			adm: inputAdm == null ? null : normalizeAdmProjectMetadata(inputAdm),
		},
	};
}

export function cloneAudioEditorProjectV7(project: AudioEditorProjectV7): AudioEditorProjectV7 {
	return clone(project);
}

export function validateAudioEditorProjectV7(project: unknown): project is AudioEditorProjectV7 {
	const candidate = objectValue(project, 'project');
	if (candidate.schemaVersion !== AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION) {
		throw new RangeError(`Unsupported audio editor schema version: ${String(candidate.schemaVersion)}.`);
	}
	validateAdmProjectMetadata(candidate.metadata);
	validateAudioEditorProjectV6(
		{ ...candidate, schemaVersion: 6 } as unknown as Parameters<typeof validateAudioEditorProjectV6>[0],
	);
	return true;
}

export function loadAudioEditorProjectV7(value: unknown): {
	project: AudioEditorProjectV7 | Record<string, unknown>;
	readOnly: boolean;
	reason: 'newer-schema' | null;
} {
	const candidate = objectValue(value, 'saved project');
	const schemaVersion = Number(candidate.schemaVersion);
	if (schemaVersion > AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION) {
		return { project: clone(candidate), readOnly: true, reason: 'newer-schema' };
	}
	validateAudioEditorProjectV7(candidate);
	const project = createAudioEditorProjectV7({
		...candidate,
		now: candidate.createdAt,
	} as AudioEditorProjectV7Options);
	validateAudioEditorProjectV7(project);
	return {
		project,
		readOnly: false,
		reason: null,
	};
}

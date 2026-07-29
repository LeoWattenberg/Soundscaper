/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	AUDIO_EDITOR_MEDIA_KINDS as V8_MEDIA_KINDS,
	AUDIO_EDITOR_TRACK_TYPES as V8_TRACK_TYPES,
	createAudioClipV8,
	createAudioEditorProjectV8,
	createAudioSourceV8,
	createAudioTrackV8,
	createLabelTrackV8,
	createMediaClipV8,
	createMediaSourceV8,
	createMediaTrackV8,
	createProjectBinV8,
	createVideoClipV8,
	createVideoSourceV8,
	createVideoTrackV8,
	validateAudioEditorProjectV8,
	type AudioEditorProjectV8,
	type AudioEditorProjectV8Options,
} from './project-v8.ts';
import {
	normalizeProjectFeatureRequirements,
	type ProjectFeatureRequirementsManifest,
} from './project-feature-requirements.ts';
import { reconcileProjectOwnedFeatureRequirements } from './project-owned-feature-requirements.ts';
import { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from './project-schema-version.ts';

export {
	AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
	AUDIO_EDITOR_PROJECT_SCHEMA_VERSION,
} from './project-schema-version.ts';
export const AUDIO_EDITOR_MEDIA_KINDS = V8_MEDIA_KINDS;
export const AUDIO_EDITOR_TRACK_TYPES = V8_TRACK_TYPES;

export interface AudioEditorProjectV9 extends Omit<AudioEditorProjectV8, 'schemaVersion'> {
	readonly schemaVersion: 9;
	readonly featureRequirements: ProjectFeatureRequirementsManifest;
}

export interface AudioEditorProjectV9Options extends AudioEditorProjectV8Options {
	readonly featureRequirements?: unknown;
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

export const createAudioSourceV9 = createAudioSourceV8;
export const createVideoSourceV9 = createVideoSourceV8;
export const createMediaSourceV9 = createMediaSourceV8;
export const createAudioClipV9 = createAudioClipV8;
export const createVideoClipV9 = createVideoClipV8;
export const createMediaClipV9 = createMediaClipV8;
export const createAudioTrackV9 = createAudioTrackV8;
export const createVideoTrackV9 = createVideoTrackV8;
export const createLabelTrackV9 = createLabelTrackV8;
export const createMediaTrackV9 = createMediaTrackV8;
export const createProjectBinV9 = createProjectBinV8;

export function createAudioEditorProjectV9(options: AudioEditorProjectV9Options = {}): AudioEditorProjectV9 {
	const { featureRequirements = { schemaVersion: 1, requirements: [] }, ...baseOptions } = options;
	const base = createAudioEditorProjectV8(baseOptions);
	const normalizedFeatureRequirements = normalizeProjectFeatureRequirements(featureRequirements, { sources: base.sources });
	return {
		...base,
		schemaVersion: AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
		featureRequirements: reconcileProjectOwnedFeatureRequirements(base, normalizedFeatureRequirements),
	};
}

export function cloneAudioEditorProjectV9(project: AudioEditorProjectV9): AudioEditorProjectV9 {
	const copy = clone(project);
	const normalizedFeatureRequirements = normalizeProjectFeatureRequirements(copy.featureRequirements, {
		sources: copy.sources as readonly Readonly<Record<string, unknown>>[],
	});
	return {
		...copy,
		featureRequirements: reconcileProjectOwnedFeatureRequirements(copy, normalizedFeatureRequirements),
	};
}

export function validateAudioEditorProjectV9(project: unknown): project is AudioEditorProjectV9 {
	const candidate = objectValue(project, 'project');
	if (candidate.schemaVersion !== AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION) {
		throw new RangeError(`Unsupported audio editor schema version: ${String(candidate.schemaVersion)}.`);
	}
	validateAudioEditorProjectV8({ ...candidate, schemaVersion: 8 });
	normalizeProjectFeatureRequirements(candidate.featureRequirements, {
		sources: candidate.sources as readonly Readonly<Record<string, unknown>>[],
	});
	return true;
}

export function loadAudioEditorProjectV9(value: unknown): {
	project: AudioEditorProjectV9 | Record<string, unknown>;
	readOnly: boolean;
	reason: 'newer-schema' | null;
} {
	const candidate = objectValue(value, 'saved project');
	const schemaVersion = Number(candidate.schemaVersion);
	if (schemaVersion > AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION) {
		return { project: clone(candidate), readOnly: true, reason: 'newer-schema' };
	}
	validateAudioEditorProjectV9(candidate);
	const project = createAudioEditorProjectV9({
		...candidate,
		now: candidate.createdAt,
	} as AudioEditorProjectV9Options);
	validateAudioEditorProjectV9(project);
	return { project, readOnly: false, reason: null };
}

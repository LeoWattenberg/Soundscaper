/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_EDITOR_PROJECT_V15_SCHEMA_VERSION } from './project-schema-version.ts';
import {
	createAudioEditorProjectV14,
	type AudioEditorProjectV14Options,
} from './project-v14.ts';
import {
	validateAudioEditorProjectV15,
	type AudioEditorProjectV15,
} from './project-v15-validation.ts';

export { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from './project-schema-version.ts';
export const AUDIO_EDITOR_PROJECT_SCHEMA_VERSION = AUDIO_EDITOR_PROJECT_V15_SCHEMA_VERSION;
export {
	AUDIO_EDITOR_PROJECT_V15_SCHEMA_VERSION,
	validateAudioEditorProjectV15,
	type AudioEditorProjectV15,
} from './project-v15-validation.ts';

export type AudioEditorProjectV15Options = AudioEditorProjectV14Options;

/** Create the exact current document with an explicit editorial lock on every track. */
export function createAudioEditorProjectV15(
	options: AudioEditorProjectV15Options = {},
): AudioEditorProjectV15 {
	const foundation = createAudioEditorProjectV14(options) as unknown as Record<string, unknown>;
	const tracks = recordArray(foundation.tracks, 'project.tracks').map((track) => ({
		...track,
		locked: Object.hasOwn(track, 'locked') ? track.locked : false,
	}));
	const project = {
		...foundation,
		schemaVersion: AUDIO_EDITOR_PROJECT_V15_SCHEMA_VERSION,
		tracks,
	};
	validateAudioEditorProjectV15(project);
	return project as unknown as AudioEditorProjectV15;
}

export function cloneAudioEditorProjectV15(project: AudioEditorProjectV15): AudioEditorProjectV15 {
	validateAudioEditorProjectV15(project);
	return clone(project);
}

export function loadAudioEditorProjectV15(value: unknown): {
	project: AudioEditorProjectV15 | Record<string, unknown>;
	readOnly: boolean;
	reason: 'newer-schema' | null;
} {
	const candidate = object(value, 'saved project');
	const schemaVersion = projectSchemaVersion(candidate.schemaVersion);
	if (schemaVersion > AUDIO_EDITOR_PROJECT_V15_SCHEMA_VERSION) {
		return { project: clone(candidate), readOnly: true, reason: 'newer-schema' };
	}
	validateAudioEditorProjectV15(candidate);
	return { project: clone(candidate), readOnly: false, reason: null };
}

function projectSchemaVersion(value: unknown): number {
	if (!Number.isSafeInteger(value)) throw new RangeError('Saved project schema version must be a safe integer.');
	return Number(value);
}

function object(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Record<string, unknown>;
}

function recordArray(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((candidate, index) => object(candidate, `${name}[${String(index)}]`));
}

function clone<Value>(value: Value): Value {
	if (value === undefined || value === null) return value;
	if (typeof structuredClone === 'function') return structuredClone(value);
	return JSON.parse(JSON.stringify(value)) as Value;
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_EDITOR_PROJECT_V14_SCHEMA_VERSION } from './project-schema-version.ts';
import {
	createAudioEditorProjectV13,
	type AudioEditorProjectV13Options,
} from './project-v13.ts';
import {
	validateAudioEditorProjectV14,
	type AudioEditorProjectV14,
} from './project-v14-validation.ts';
import { reconcileVideoSourceCharacteristicsV14 } from './source-characteristics-v14.ts';

export { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from './project-schema-version.ts';
export const AUDIO_EDITOR_PROJECT_SCHEMA_VERSION = AUDIO_EDITOR_PROJECT_V14_SCHEMA_VERSION;
export {
	AUDIO_EDITOR_PROJECT_V14_SCHEMA_VERSION,
	validateAudioEditorProjectV14,
	type AudioEditorProjectV14,
} from './project-v14-validation.ts';

export type AudioEditorProjectV14Options = AudioEditorProjectV13Options;

/** Create the exact current document: V13 with probed source characteristics. */
export function createAudioEditorProjectV14(
	options: AudioEditorProjectV14Options = {},
): AudioEditorProjectV14 {
	const foundation = createAudioEditorProjectV13(options) as unknown as Record<string, unknown>;
	const project = { ...foundation, schemaVersion: AUDIO_EDITOR_PROJECT_V14_SCHEMA_VERSION };
	reconcileVideoSourceCharacteristicsV14(project);
	validateAudioEditorProjectV14(project);
	return project as unknown as AudioEditorProjectV14;
}

export function cloneAudioEditorProjectV14(project: AudioEditorProjectV14): AudioEditorProjectV14 {
	validateAudioEditorProjectV14(project);
	return clone(project);
}

export function loadAudioEditorProjectV14(value: unknown): {
	project: AudioEditorProjectV14 | Record<string, unknown>;
	readOnly: boolean;
	reason: 'newer-schema' | null;
} {
	const candidate = object(value, 'saved project');
	const schemaVersion = projectSchemaVersion(candidate.schemaVersion);
	if (schemaVersion > AUDIO_EDITOR_PROJECT_V14_SCHEMA_VERSION) {
		return { project: clone(candidate), readOnly: true, reason: 'newer-schema' };
	}
	validateAudioEditorProjectV14(candidate);
	return { project: clone(candidate) as AudioEditorProjectV14, readOnly: false, reason: null };
}

function projectSchemaVersion(value: unknown): number {
	if (!Number.isSafeInteger(value)) throw new RangeError('Saved project schema version must be a safe integer.');
	return Number(value);
}

function object(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Record<string, unknown>;
}

function clone<Value>(value: Value): Value {
	if (value === undefined || value === null) return value;
	if (typeof structuredClone === 'function') return structuredClone(value);
	return JSON.parse(JSON.stringify(value)) as Value;
}

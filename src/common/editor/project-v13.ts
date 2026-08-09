/* SPDX-License-Identifier: AGPL-3.0-only */

import { reconcileFolderBusesV13 } from './folder-bus-v13.ts';
import { AUDIO_EDITOR_PROJECT_V13_SCHEMA_VERSION } from './project-schema-version.ts';
import {
	createAudioEditorProjectV12,
	type AudioEditorProjectV12Options,
} from './project-v12.ts';
import {
	validateAudioEditorProjectV13,
	type AudioEditorProjectV13,
} from './project-v13-validation.ts';

export { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from './project-schema-version.ts';
export const AUDIO_EDITOR_PROJECT_SCHEMA_VERSION = AUDIO_EDITOR_PROJECT_V13_SCHEMA_VERSION;
export {
	AUDIO_EDITOR_PROJECT_V13_SCHEMA_VERSION,
	validateAudioEditorProjectV13,
	type AudioEditorProjectV13,
} from './project-v13-validation.ts';

export type AudioEditorProjectV13Options = AudioEditorProjectV12Options;

/** Create the exact current document: the V12 hierarchy with reconciled folder buses. */
export function createAudioEditorProjectV13(
	options: AudioEditorProjectV13Options = {},
): AudioEditorProjectV13 {
	const foundation = createAudioEditorProjectV12(options) as unknown as Record<string, unknown>;
	const project = { ...foundation, schemaVersion: AUDIO_EDITOR_PROJECT_V13_SCHEMA_VERSION };
	reconcileFolderBusesV13(project);
	validateAudioEditorProjectV13(project);
	return project as unknown as AudioEditorProjectV13;
}

export function cloneAudioEditorProjectV13(project: AudioEditorProjectV13): AudioEditorProjectV13 {
	validateAudioEditorProjectV13(project);
	return clone(project);
}

export function loadAudioEditorProjectV13(value: unknown): {
	project: AudioEditorProjectV13 | Record<string, unknown>;
	readOnly: boolean;
	reason: 'newer-schema' | null;
} {
	const candidate = object(value, 'saved project');
	const schemaVersion = projectSchemaVersion(candidate.schemaVersion);
	if (schemaVersion > AUDIO_EDITOR_PROJECT_V13_SCHEMA_VERSION) {
		return { project: clone(candidate), readOnly: true, reason: 'newer-schema' };
	}
	validateAudioEditorProjectV13(candidate);
	return { project: clone(candidate) as AudioEditorProjectV13, readOnly: false, reason: null };
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

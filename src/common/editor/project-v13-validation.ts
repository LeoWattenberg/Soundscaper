/* SPDX-License-Identifier: AGPL-3.0-only */

import { validateFolderBusesV13 } from './folder-bus-v13.ts';
import { AUDIO_EDITOR_PROJECT_V13_SCHEMA_VERSION } from './project-schema-version.ts';
import {
	validateAudioEditorFolderHierarchyDocument,
	type AudioEditorFolderHierarchyDocument,
	type AudioEditorProjectV12ValidationOptions,
} from './project-v12-validation.ts';

export { AUDIO_EDITOR_PROJECT_V13_SCHEMA_VERSION } from './project-schema-version.ts';

export type AudioEditorProjectV13ValidationOptions = AudioEditorProjectV12ValidationOptions;

export interface AudioEditorProjectV13 extends AudioEditorFolderHierarchyDocument {
	readonly schemaVersion: 13;
}

/**
 * Validate the exact V13 persistence document: the V12 folder hierarchy plus
 * the folder bus contract, where a top-level folder holding audio owns the
 * group bus carrying its identity and every audio track beneath it feeds that
 * bus.
 */
export function validateAudioEditorProjectV13(
	project: unknown,
	options: AudioEditorProjectV13ValidationOptions = {},
): project is AudioEditorProjectV13 {
	validateAudioEditorFolderHierarchyDocument(
		project,
		AUDIO_EDITOR_PROJECT_V13_SCHEMA_VERSION,
		options,
	);
	validateFolderBusesV13(project as Record<string, unknown>);
	return true;
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import { validateFolderBusesV13 } from './folder-bus-v13.ts';
import { AUDIO_EDITOR_PROJECT_V14_SCHEMA_VERSION } from './project-schema-version.ts';
import {
	validateAudioEditorFolderHierarchyDocument,
	type AudioEditorFolderHierarchyDocument,
	type AudioEditorProjectV12ValidationOptions,
} from './project-v12-validation.ts';
import { validateVideoSourceCharacteristicsV14 } from './source-characteristics-v14.ts';

export { AUDIO_EDITOR_PROJECT_V14_SCHEMA_VERSION } from './project-schema-version.ts';

export type AudioEditorProjectV14ValidationOptions = AudioEditorProjectV12ValidationOptions;

export interface AudioEditorProjectV14 extends AudioEditorFolderHierarchyDocument {
	readonly schemaVersion: 14;
}

/**
 * Validate the exact V14 persistence document: the V13 folder-bus document
 * plus the probed characteristics every video source carries, where an
 * unreported characteristic is stated rather than absent.
 */
export function validateAudioEditorProjectV14(
	project: unknown,
	options: AudioEditorProjectV14ValidationOptions = {},
): project is AudioEditorProjectV14 {
	validateAudioEditorFolderHierarchyDocument(
		project,
		AUDIO_EDITOR_PROJECT_V14_SCHEMA_VERSION,
		options,
	);
	validateFolderBusesV13(project as Record<string, unknown>);
	validateVideoSourceCharacteristicsV14(project as Record<string, unknown>);
	return true;
}

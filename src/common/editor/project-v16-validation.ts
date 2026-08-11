/* SPDX-License-Identifier: AGPL-3.0-only */

import { validateFolderBusesV13 } from './folder-bus-v13.ts';
import { AUDIO_EDITOR_PROJECT_V16_SCHEMA_VERSION } from './project-schema-version.ts';
import {
	validateAudioEditorFolderHierarchyDocument,
	type AudioEditorFolderHierarchyDocument,
	type AudioEditorProjectV12ValidationOptions,
} from './project-v12-validation.ts';
import { validateTrackLocksV15 } from './project-v15-validation.ts';
import { validateVideoSourceCharacteristicsV14 } from './source-characteristics-v14.ts';

export { AUDIO_EDITOR_PROJECT_V16_SCHEMA_VERSION } from './project-schema-version.ts';

export type AudioEditorProjectV16ValidationOptions = AudioEditorProjectV12ValidationOptions;

export interface AudioEditorProjectV16 extends AudioEditorFolderHierarchyDocument {
	readonly schemaVersion: 16;
}

/** Validate the exact V16 persistence document and its inherited V15 layers. */
export function validateAudioEditorProjectV16(
	project: unknown,
	options: AudioEditorProjectV16ValidationOptions = {},
): project is AudioEditorProjectV16 {
	validateAudioEditorFolderHierarchyDocument(
		project,
		AUDIO_EDITOR_PROJECT_V16_SCHEMA_VERSION,
		options,
	);
	validateFolderBusesV13(project as Record<string, unknown>);
	validateVideoSourceCharacteristicsV14(project as Record<string, unknown>);
	validateTrackLocksV15(project as AudioEditorFolderHierarchyDocument);
	return true;
}

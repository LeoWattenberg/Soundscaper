/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	cloneAudioEditorProjectV17,
	createAudioEditorProjectV17,
	loadAudioEditorProjectV17,
	type AudioEditorProjectV17Options,
} from './project-v17.ts';
import {
	validateAudioEditorProjectV17,
	type AudioEditorProjectV17,
} from './project-v17-validation.ts';

export {
	AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
	AUDIO_EDITOR_PROJECT_SCHEMA_VERSION,
} from './project-schema-version.ts';

export type AudioEditorProjectCurrent = AudioEditorProjectV17;
export type AudioEditorProjectCurrentOptions = AudioEditorProjectV17Options;

export const createCurrentAudioEditorProject = createAudioEditorProjectV17;
export const cloneCurrentAudioEditorProject = cloneAudioEditorProjectV17;
export const loadCurrentAudioEditorProject = loadAudioEditorProjectV17;
export const validateCurrentAudioEditorProject = validateAudioEditorProjectV17;

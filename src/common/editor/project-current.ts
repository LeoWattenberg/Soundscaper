/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	cloneAudioEditorProjectV14,
	createAudioEditorProjectV14,
	loadAudioEditorProjectV14,
	type AudioEditorProjectV14Options,
} from './project-v14.ts';
import {
	validateAudioEditorProjectV14,
	type AudioEditorProjectV14,
} from './project-v14-validation.ts';

export {
	AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
	AUDIO_EDITOR_PROJECT_SCHEMA_VERSION,
} from './project-schema-version.ts';

export type AudioEditorProjectCurrent = AudioEditorProjectV14;
export type AudioEditorProjectCurrentOptions = AudioEditorProjectV14Options;

export const createCurrentAudioEditorProject = createAudioEditorProjectV14;
export const cloneCurrentAudioEditorProject = cloneAudioEditorProjectV14;
export const loadCurrentAudioEditorProject = loadAudioEditorProjectV14;
export const validateCurrentAudioEditorProject = validateAudioEditorProjectV14;

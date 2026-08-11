/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	cloneAudioEditorProjectV16,
	createAudioEditorProjectV16,
	loadAudioEditorProjectV16,
	type AudioEditorProjectV16Options,
} from './project-v16.ts';
import {
	validateAudioEditorProjectV16,
	type AudioEditorProjectV16,
} from './project-v16-validation.ts';

export {
	AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
	AUDIO_EDITOR_PROJECT_SCHEMA_VERSION,
} from './project-schema-version.ts';

export type AudioEditorProjectCurrent = AudioEditorProjectV16;
export type AudioEditorProjectCurrentOptions = AudioEditorProjectV16Options;

export const createCurrentAudioEditorProject = createAudioEditorProjectV16;
export const cloneCurrentAudioEditorProject = cloneAudioEditorProjectV16;
export const loadCurrentAudioEditorProject = loadAudioEditorProjectV16;
export const validateCurrentAudioEditorProject = validateAudioEditorProjectV16;

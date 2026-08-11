/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	cloneAudioEditorProjectV15,
	createAudioEditorProjectV15,
	loadAudioEditorProjectV15,
	type AudioEditorProjectV15Options,
} from './project-v15.ts';
import {
	validateAudioEditorProjectV15,
	type AudioEditorProjectV15,
} from './project-v15-validation.ts';

export {
	AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
	AUDIO_EDITOR_PROJECT_SCHEMA_VERSION,
} from './project-schema-version.ts';

export type AudioEditorProjectCurrent = AudioEditorProjectV15;
export type AudioEditorProjectCurrentOptions = AudioEditorProjectV15Options;

export const createCurrentAudioEditorProject = createAudioEditorProjectV15;
export const cloneCurrentAudioEditorProject = cloneAudioEditorProjectV15;
export const loadCurrentAudioEditorProject = loadAudioEditorProjectV15;
export const validateCurrentAudioEditorProject = validateAudioEditorProjectV15;

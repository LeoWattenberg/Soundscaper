/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	validateAudioEditorProjectV17,
	type AudioEditorProjectV17,
} from '../common/editor/project-v17.ts';
import {
	createSoundscaperProject,
	type SoundscaperProjectOptions,
} from './editor-project.ts';
import type { SoundscaperProject } from './editor-project-validation.ts';

/** Promote maintained Audacity decoder output into the baseline family. */
export function importSoundscaperAudacityProject(value: unknown): SoundscaperProject {
	validateAudioEditorProjectV17(value);
	const decoded = structuredClone(value) as AudioEditorProjectV17;
	const foundation = { ...decoded } as Record<string, unknown>;
	delete foundation.mixer;
	delete foundation.schemaFamily;
	delete foundation.schemaVersion;
	return createSoundscaperProject({
		...foundation,
		now: decoded.createdAt,
	} as SoundscaperProjectOptions);
}

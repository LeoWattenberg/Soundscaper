/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	validateSoundscaperProject,
	type SoundscaperProject,
} from '../src/soundscaper/editor-project-validation.ts';

/**
 * Apply the baseline desktop's one exact local owner and current-document boundary.
 *
 * Main holds whichever production revision the mounted renderer publishes, and
 * it is named in exactly this one place so following the next flip is a single
 * import rather than a search for every surface that still says V21.
 */
export function validateSoundscaperDesktopCurrentProject(value: unknown): SoundscaperProject {
	validateSoundscaperProject(value);
	return value as SoundscaperProject;
}

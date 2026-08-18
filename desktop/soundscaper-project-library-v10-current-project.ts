/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	validateSoundscaperProjectV23,
	type SoundscaperProjectV23,
} from '../src/soundscaper/editor-project-v23-validation.ts';

/**
 * Apply the V10 desktop's one exact local owner and current-document boundary.
 *
 * Main holds whichever production revision the mounted renderer publishes, and
 * it is named in exactly this one place so following the next flip is a single
 * import rather than a search for every surface that still says V21.
 */
export function validateSoundscaperDesktopCurrentProject(value: unknown): SoundscaperProjectV23 {
	validateSoundscaperProjectV23(value);
	return value as SoundscaperProjectV23;
}

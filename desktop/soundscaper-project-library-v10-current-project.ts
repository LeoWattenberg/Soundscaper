/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	validateSoundscaperProjectV21,
	type SoundscaperProjectV21,
} from '../src/soundscaper/editor-project-v21-validation.ts';

/** Apply the V10 desktop's one exact local owner and V21 document boundary. */
export function validateSoundscaperDesktopCurrentProjectV21(value: unknown): SoundscaperProjectV21 {
	validateSoundscaperProjectV21(value);
	return value as SoundscaperProjectV21;
}

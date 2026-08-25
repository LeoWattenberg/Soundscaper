/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorProjectRuntimeProfile } from '../src/common/editor/project-runtime-profile.ts';
import { FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v31.ts';
import {
	validateFramescaperProjectV31,
	type FramescaperProjectV31,
} from '../src/framescaper/editor-project-v31-validation.ts';

/** Apply the selected V20 desktop library's exact V31 document boundary. */
export function validateFramescaperDesktopV20CurrentProjectV31(
	value: unknown,
	profile: EditorProjectRuntimeProfile | unknown = FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE,
): FramescaperProjectV31 {
	if (profile !== FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE) {
		throw new TypeError('The exact Framescaper V31 runtime profile is required.');
	}
	validateFramescaperProjectV31(FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE, value);
	return value as FramescaperProjectV31;
}

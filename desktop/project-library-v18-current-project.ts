/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorProjectRuntimeProfile } from '../src/common/editor/project-runtime-profile.ts';
import { FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v27.ts';
import {
	validateFramescaperProjectV27,
	type FramescaperProjectV27,
} from '../src/framescaper/editor-project-v27-validation.ts';

/** Apply the selected V18 desktop library's exact V27 document boundary. */
export function validateFramescaperDesktopV18CurrentProjectV27(
	value: unknown,
	profile: EditorProjectRuntimeProfile | unknown = FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE,
): FramescaperProjectV27 {
	if (profile !== FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE) {
		throw new TypeError('The exact Framescaper V27 runtime profile is required.');
	}
	validateFramescaperProjectV27(FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE, value);
	return value as FramescaperProjectV27;
}

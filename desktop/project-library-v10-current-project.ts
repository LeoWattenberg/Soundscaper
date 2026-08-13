/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorProjectRuntimeProfile } from '../src/common/editor/project-runtime-profile.ts';
import {
	FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile-v18.ts';
import {
	validateFramescaperProjectV18,
	type FramescaperProjectV18,
	type FramescaperProjectV18ValidationOptions,
} from '../src/framescaper/editor-project-v18-validation.ts';

/** Apply the V10 desktop's one exact local owner and V18 document boundary. */
export function validateFramescaperDesktopCurrentProjectV18(
	value: unknown,
	profile: EditorProjectRuntimeProfile | unknown = FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
	options: FramescaperProjectV18ValidationOptions = {},
): FramescaperProjectV18 {
	if (profile !== FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE) {
		throw new TypeError('The exact Framescaper V18 runtime profile is required.');
	}
	validateFramescaperProjectV18(profile, value, options);
	return value;
}

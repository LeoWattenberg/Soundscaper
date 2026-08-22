/* SPDX-License-Identifier: AGPL-3.0-only */

import { FRAMESCAPER_V22_PROJECT_CANDIDATE_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v22.ts';
import {
	validateFramescaperProjectV22,
	type FramescaperProjectV22,
} from '../src/framescaper/editor-project-v22-validation.ts';

export function validateFramescaperDesktopCurrentProjectV22(value: unknown): FramescaperProjectV22 {
	validateFramescaperProjectV22(FRAMESCAPER_V22_PROJECT_CANDIDATE_PROFILE, value);
	return value as FramescaperProjectV22;
}

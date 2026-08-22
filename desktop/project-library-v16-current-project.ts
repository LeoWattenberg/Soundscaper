/* SPDX-License-Identifier: AGPL-3.0-only */

import { FRAMESCAPER_V26_PROJECT_CANDIDATE_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v26.ts';
import {
	validateFramescaperProjectV26,
	type FramescaperProjectV26,
} from '../src/framescaper/editor-project-v26-validation.ts';

export function validateFramescaperDesktopCurrentProjectV26(value: unknown): FramescaperProjectV26 {
	validateFramescaperProjectV26(FRAMESCAPER_V26_PROJECT_CANDIDATE_PROFILE, value);
	return value as FramescaperProjectV26;
}

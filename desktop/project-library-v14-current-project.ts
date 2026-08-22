/* SPDX-License-Identifier: AGPL-3.0-only */

import { FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v24.ts';
import {
	validateFramescaperProjectV24,
	type FramescaperProjectV24,
} from '../src/framescaper/editor-project-v24-validation.ts';

export function validateFramescaperDesktopCurrentProjectV24(value: unknown): FramescaperProjectV24 {
	validateFramescaperProjectV24(FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE, value);
	return value as FramescaperProjectV24;
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import { FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v25.ts';
import {
	validateFramescaperProjectV25,
	type FramescaperProjectV25,
} from '../src/framescaper/editor-project-v25-validation.ts';

export function validateFramescaperDesktopCurrentProjectV25(value: unknown): FramescaperProjectV25 {
	validateFramescaperProjectV25(FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE, value);
	return value as FramescaperProjectV25;
}

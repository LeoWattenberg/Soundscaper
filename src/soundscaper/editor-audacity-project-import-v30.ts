/* SPDX-License-Identifier: AGPL-3.0-only */

import { importSoundscaperAudacityProjectV29 } from './editor-audacity-project-import-v29.ts';
import {
	upgradeSoundscaperProjectV29ToV30,
	type SoundscaperProjectV30,
} from './editor-project-v30.ts';

/** Promote maintained Audacity decoder output into the selected empty-assistance V30 authority. */
export function importSoundscaperAudacityProjectV30(value: unknown): SoundscaperProjectV30 {
	return upgradeSoundscaperProjectV29ToV30(importSoundscaperAudacityProjectV29(value));
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	validateAudioEditorProjectV17,
	type AudioEditorProjectV17,
} from '../common/editor/project-v17.ts'
import {
	createSoundscaperProjectV29,
	type SoundscaperProjectV29Options,
} from './editor-project-v29.ts'
import type { SoundscaperProjectV29 } from './editor-project-v29-validation.ts'

/** Promote only the exact maintained Audacity decoder output into V29 authority. */
export function importSoundscaperAudacityProjectV29(value: unknown): SoundscaperProjectV29 {
	validateAudioEditorProjectV17(value)
	const decoded = structuredClone(value) as AudioEditorProjectV17
	const foundation = { ...decoded } as Record<string, unknown>
	delete foundation.mixer
	delete foundation.schemaVersion
	return createSoundscaperProjectV29({
		...foundation,
		now: decoded.createdAt,
	} as SoundscaperProjectV29Options)
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	validateAudioEditorProjectV17,
	type AudioEditorProjectV17,
} from '../common/editor/project-v17.ts'
import {
	createSoundscaperProjectV23,
	type SoundscaperProjectV23Options,
} from './editor-project-v23.ts'
import type { SoundscaperProjectV23 } from './editor-project-v23-validation.ts'

/** Promote only the exact maintained Audacity decoder output into V23 authority. */
export function importSoundscaperAudacityProjectV23(value: unknown): SoundscaperProjectV23 {
	validateAudioEditorProjectV17(value)
	const decoded = structuredClone(value) as AudioEditorProjectV17
	const foundation = { ...decoded } as Record<string, unknown>
	delete foundation.mixer
	delete foundation.schemaVersion
	return createSoundscaperProjectV23({
		...foundation,
		now: decoded.createdAt,
	} as SoundscaperProjectV23Options)
}

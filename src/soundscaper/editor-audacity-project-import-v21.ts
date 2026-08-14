/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	validateAudioEditorProjectV17,
	type AudioEditorProjectV17,
} from '../common/editor/project-v17.ts'
import {
	createSoundscaperProjectV21,
	type SoundscaperProjectV21Options,
} from './editor-project-v21.ts'
import type { SoundscaperProjectV21 } from './editor-project-v21-validation.ts'

/** Promote only the exact maintained Audacity decoder output into V21 authority. */
export function importSoundscaperAudacityProjectV21(value: unknown): SoundscaperProjectV21 {
	validateAudioEditorProjectV17(value)
	const decoded = structuredClone(value) as AudioEditorProjectV17
	const foundation = { ...decoded } as Record<string, unknown>
	delete foundation.mixer
	delete foundation.schemaVersion
	return createSoundscaperProjectV21({
		...foundation,
		now: decoded.createdAt,
	} as SoundscaperProjectV21Options)
}

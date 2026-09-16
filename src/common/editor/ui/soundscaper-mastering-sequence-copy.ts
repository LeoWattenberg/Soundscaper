/* SPDX-License-Identifier: AGPL-3.0-only */

import { SOUNDSCAPER_MASTERING_SEQUENCE_COPY } from '../../i18n/editor-soundscaper-mastering-sequence-copy.ts';
export { SOUNDSCAPER_MASTERING_SEQUENCE_COPY } from '../../i18n/editor-soundscaper-mastering-sequence-copy.ts';
import { resolveEditorCopyScope } from '../../i18n/editor-copy-scope.ts';



export type SoundscaperMasteringSequenceCopy = Readonly<{
	[Key in keyof typeof SOUNDSCAPER_MASTERING_SEQUENCE_COPY]: string;
}>;

export function resolveSoundscaperMasteringSequenceCopy(
	copy: Readonly<Record<string, string | undefined>> = {},
): SoundscaperMasteringSequenceCopy {
	return resolveEditorCopyScope('mastering', SOUNDSCAPER_MASTERING_SEQUENCE_COPY, copy);
}

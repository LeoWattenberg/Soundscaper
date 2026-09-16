/* SPDX-License-Identifier: AGPL-3.0-only */

import { SOUNDSCAPER_NATIVE_SERVICES_COPY } from '../../i18n/editor-soundscaper-native-services-copy.ts';
export { SOUNDSCAPER_NATIVE_SERVICES_COPY } from '../../i18n/editor-soundscaper-native-services-copy.ts';
import { resolveEditorCopyScope } from '../../i18n/editor-copy-scope.ts';



export type SoundscaperNativeServicesCopy = Readonly<{
	[Key in keyof typeof SOUNDSCAPER_NATIVE_SERVICES_COPY]: string;
}>;

/** Resolve optional host localization without requiring a shared catalog change. */
export function resolveSoundscaperNativeServicesCopy(
	copy: Readonly<Record<string, string | undefined>> = {},
): SoundscaperNativeServicesCopy {
	return resolveEditorCopyScope('soundscaperNative', SOUNDSCAPER_NATIVE_SERVICES_COPY, copy);
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import { FRAMESCAPER_NATIVE_SERVICES_COPY } from '../../i18n/editor-framescaper-native-services-copy.ts';
export { FRAMESCAPER_NATIVE_SERVICES_COPY } from '../../i18n/editor-framescaper-native-services-copy.ts';
import { resolveEditorCopyScope } from '../../i18n/editor-copy-scope.ts';




export type FramescaperNativeServicesCopy = Readonly<{
	[Key in keyof typeof FRAMESCAPER_NATIVE_SERVICES_COPY]: string;
}>;

/** Resolve optional host localization without requiring a shared catalog change. */
export function resolveFramescaperNativeServicesCopy(
	copy: Readonly<Record<string, string | undefined>> = {},
): FramescaperNativeServicesCopy {
	return resolveEditorCopyScope('framescaperNative', FRAMESCAPER_NATIVE_SERVICES_COPY, copy);
}

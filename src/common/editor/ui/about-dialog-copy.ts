/* SPDX-License-Identifier: AGPL-3.0-only */

import { ABOUT_DIALOG_COPY_BY_LOCALE } from '../../i18n/editor-about-dialog-copy.ts';
import { resolveEditorCopyScope } from '../../i18n/editor-copy-scope.ts';

export type AboutDialogCopy = Readonly<Record<keyof typeof ABOUT_DIALOG_COPY_BY_LOCALE.en, string>>;

export function resolveAboutDialogCopy(
	copy: Readonly<Record<string, unknown>> = {},
): AboutDialogCopy {
	return resolveEditorCopyScope('about', ABOUT_DIALOG_COPY_BY_LOCALE.en, copy);
}

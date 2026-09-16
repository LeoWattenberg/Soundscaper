/* SPDX-License-Identifier: AGPL-3.0-only */

import { TRACK_AUTOMATION_COPY_BY_LOCALE } from '../../../i18n/editor-track-automation-copy.ts';
import { resolveEditorCopyScope } from '../../../i18n/editor-copy-scope.ts';


export function resolveTrackAutomationCopy(locale: string | null | undefined, copy: Readonly<Record<string, string | undefined>> = {}) {
	const base = String(locale || '').toLowerCase().startsWith('de') ? TRACK_AUTOMATION_COPY_BY_LOCALE.de : TRACK_AUTOMATION_COPY_BY_LOCALE.en;
	return resolveEditorCopyScope('trackAutomation', base, copy);
}

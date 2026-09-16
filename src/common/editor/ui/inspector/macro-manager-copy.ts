/* SPDX-License-Identifier: AGPL-3.0-only */

import { MACRO_MANAGER_COPY_BY_LOCALE } from '../../../i18n/editor-macro-manager-copy.ts';
import { resolveEditorCopyScope } from '../../../i18n/editor-copy-scope.ts';

export interface MacroManagerCopy {
	readonly cancelRun: string;
	readonly runCancelled: string;
	readonly newProgram: string;
	readonly program: string;
	readonly programName: string;
	readonly runProgram: string;
	readonly programApplied: string;
	readonly sandboxNotice: string;
	readonly tabHint: string;
	readonly failure: string;
	readonly failureAtLine: string;
	readonly importProgram: string;
	readonly exportProgram: string;
	readonly deleteProgram: string;
	readonly programImported: string;
	readonly programImportFailed: string;
	readonly reviewHeading: string;
	readonly reviewOrigin: string;
	readonly reviewUnknownOrigin: string;
	readonly reviewRisk: string;
	readonly reviewAcknowledge: string;
	readonly enableProgram: string;
	readonly notTrusted: string;
	readonly programs: string;
}


/**
 * Copy the macro manager owns, kept out of the legacy catalog.
 *
 * `src/common/i18n/catalogs.js` sits exactly on its size ratchet, so a topical
 * module is where new manager strings belong — the same arrangement the built-in
 * template copy already uses.
 */
export function resolveMacroManagerCopy(locale?: string, copy: Readonly<Record<string, string | undefined>> = {}): MacroManagerCopy {
	const base = locale?.toLowerCase().startsWith('de') ? MACRO_MANAGER_COPY_BY_LOCALE.de : MACRO_MANAGER_COPY_BY_LOCALE.en;
	return resolveEditorCopyScope('macroManager', base, copy);
}

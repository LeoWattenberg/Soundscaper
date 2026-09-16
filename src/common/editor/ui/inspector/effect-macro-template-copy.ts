/* SPDX-License-Identifier: AGPL-3.0-only */

import { EFFECT_MACRO_TEMPLATE_COPY_BY_LOCALE } from '../../../i18n/editor-effect-macro-template-copy.ts';
import { resolveEditorCopyScope } from '../../../i18n/editor-copy-scope.ts';

export interface EffectMacroTemplateCopy {
	readonly templates: string;
	readonly restoration: string;
	/** One label per built-in template, keyed by its id. */
	readonly names: Readonly<Record<string, string>>;
	readonly profileRequired: string;
}


/** Keep the focused template UI localized without growing the legacy catalog. */
export function resolveEffectMacroTemplateCopy(locale?: string, copy: Readonly<Record<string, string | undefined>> = {}): EffectMacroTemplateCopy {
	const base = locale?.toLowerCase().startsWith('de') ? EFFECT_MACRO_TEMPLATE_COPY_BY_LOCALE.de : EFFECT_MACRO_TEMPLATE_COPY_BY_LOCALE.en;
	const { names, ...labels } = base;
	return Object.freeze({ ...resolveEditorCopyScope('effectMacroTemplate', labels, copy),
		names: resolveEditorCopyScope('effectMacroTemplate.names', names, copy) });
}

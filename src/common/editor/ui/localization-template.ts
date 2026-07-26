/* SPDX-License-Identifier: AGPL-3.0-only */

export type LocalizedTemplateValue = string | number;

export interface AccessibleTemplateCopy {
	readonly optionsFor: string;
	readonly resizeFor: string;
}

/**
 * Format a flat-catalog template and fail fast when a placeholder is missing.
 * Keeping interpolation here prevents feature components from baking English
 * punctuation or word order into accessible names.
 */
export function formatLocalizedTemplate(
	template: string,
	values: Readonly<Record<string, LocalizedTemplateValue>>,
): string {
	if (typeof template !== 'string' || !template) throw new TypeError('A localized template is required.');
	return template.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/gu, (_placeholder, name: string) => {
		if (!Object.hasOwn(values, name)) throw new ReferenceError(`Missing localized template value: ${name}.`);
		return String(values[name]);
	});
}

export function formatOptionsLabel(copy: AccessibleTemplateCopy, name: string): string {
	return formatLocalizedTemplate(copy.optionsFor, { name });
}

export function formatResizeLabel(copy: AccessibleTemplateCopy, name: string): string {
	return formatLocalizedTemplate(copy.resizeFor, { name });
}

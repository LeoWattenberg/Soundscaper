/* SPDX-License-Identifier: AGPL-3.0-only */

/** Resolve independently owned labels without confusing identical local keys. */
export function resolveEditorCopyScope<Catalog extends Readonly<Record<string, string>>>(
	owner: string,
	defaults: Catalog,
	overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Catalog> {
	const result: Record<string, string> = {};
	for (const [key, fallback] of Object.entries(defaults)) {
		const translated = overrides[`ui.${owner}.${key}`] ?? overrides[key];
		result[key] = typeof translated === 'string' && translated.trim() ? translated : fallback;
	}
	return Object.freeze(result) as Readonly<Catalog>;
}

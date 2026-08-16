/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * One override policy for every flat editor copy catalog.
 *
 * A host may replace a key the catalog already declares, and only with text: an
 * empty or absent translation falls back to the shipped string rather than
 * blanking a control, and a key the catalog does not declare names a control
 * this surface does not have. Deciding that here means the policy is argued
 * once instead of drifting between the catalogs that apply it.
 */
export function resolveCopyCatalogOverrides<Catalog extends Readonly<Record<string, string>>>(
	catalog: Catalog,
	overrides: Readonly<Record<string, string | undefined>> = {},
): Readonly<Catalog> {
	const output: Record<string, string> = { ...catalog };
	for (const key of Object.keys(output)) {
		const candidate = overrides[key];
		if (typeof candidate === 'string' && candidate.length > 0) output[key] = candidate;
	}
	return Object.freeze(output) as Readonly<Catalog>;
}

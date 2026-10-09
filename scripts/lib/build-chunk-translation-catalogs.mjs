/* SPDX-License-Identifier: AGPL-3.0-only */

import { TRANSLATION_CATALOG_PART_PREFIX } from './translation-catalog-partition.mjs';

/** @param {string} id */
export function translationCatalogPartChunkName(id) {
	if (!id.startsWith(TRANSLATION_CATALOG_PART_PREFIX)) return null;
	const match = /[\\/]([^\\/]+)\.json:(\d+)\.mjs$/u.exec(id);
	return match ? `locale-${match[1]}-entries-${match[2]}` : null;
}

/** @type {import('rolldown').CodeSplittingGroup[]} */
export const translationCatalogChunkGroups = [{
	name: translationCatalogPartChunkName,
	test: /^\0scape:translation-catalog-part:/u,
	priority: 102,
	minSize: 0,
	maxSize: 400_000,
	includeDependenciesRecursively: false,
}];

/**
 * Catalog roots already statically import their parts. Speculative preload
 * lists otherwise duplicate every locale's part filenames in the eager loader
 * chunk, growing startup even when that locale is never selected. Preserve all
 * unrelated JS/CSS dependencies and let native imports discover these parts.
 *
 * @param {string} filename
 * @param {string[]} dependencies
 * @returns {string[]}
 */
export function translationCatalogPreloadDependencies(filename, dependencies) {
	if (!/(?:^|\/)[^/]+\.json-[^/]+\.m?js$/u.test(filename)) return dependencies;
	const part = /(?:^|\/)locale-[^/]+-entries-\d+-[^/]+\.m?js$/u;
	if (!dependencies.some(dependency => part.test(dependency))) return dependencies;
	return dependencies.filter(dependency => dependency !== filename && !part.test(dependency));
}

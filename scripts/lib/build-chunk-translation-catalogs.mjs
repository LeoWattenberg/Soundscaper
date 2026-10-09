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

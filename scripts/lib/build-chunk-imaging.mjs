/* SPDX-License-Identifier: AGPL-3.0-only */

// Product-neutral image kernels are consumed by both the optional Frame image
// slice and the menu-owned photo workflow. A stable owner prevents a shared
// kernel from being placed inside whichever lazy product chunk reaches it first.
/** @type {import('rolldown').CodeSplittingGroup[]} */
export const imagingChunkGroups = [{
	name: 'editor-imaging',
	test: /src[\\/]common[\\/]editor[\\/]imaging[\\/][^\\/]+\.ts$/,
	priority: 66,
	minSize: 0,
	maxSize: 400_000,
	includeDependenciesRecursively: false,
}];

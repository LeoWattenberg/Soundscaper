/* SPDX-License-Identifier: AGPL-3.0-only */

/** Scene values and CPU raster assets have distinct owners so lazy CanvasKit never initializes from the shell. */
export const motionChunkGroups = [
	{ name: 'motion-link-page', priority: 113, minSize: 0, maxSize: 400_000, includeDependenciesRecursively: false,
		test: /src[\\/]common[\\/]editor[\\/]ui[\\/]composition-link[\\/]/ },
	{ name: 'motion-link-copy', priority: 112, minSize: 0, maxSize: 400_000, includeDependenciesRecursively: false,
		test: /src[\\/]common[\\/]i18n[\\/]editor-motion-link-bridge-copy\.ts$/ },
	{ name: 'motion-link-bridge', priority: 111, minSize: 0, maxSize: 400_000, includeDependenciesRecursively: false,
		test: /src[\\/]common[\\/]editor[\\/](?:motion-link-(?:wire|connection-urls)\.ts|controller[\\/]composition[\\/](?:motion-link-window-bridge\.ts|internal[\\/]motion-link-broadcast(?:-relay)?\.ts))$/ },
	{ name: 'motion-raster', priority: 101, minSize: 0, maxSize: 400_000, includeDependenciesRecursively: false,
		test: /(?:src[\\/]common[\\/]editor[\\/](?:motion-canvaskit-[^\\/]+\.ts|controller[\\/]composition[\\/]motion-raster-runtime\.ts)|config[\\/]motionscaper-raster-runtime\.json|node_modules[\\/](?:canvaskit-wasm|@fontsource[\\/]inter)[\\/])/ },
	{ name: 'motion-domain', priority: 100, minSize: 0, maxSize: 400_000, includeDependenciesRecursively: false,
		test: /src[\\/]common[\\/]editor[\\/]motion-(?!canvaskit-)[^\\/]+\.ts$/ },
];

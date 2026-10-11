// @ts-check
/* SPDX-License-Identifier: AGPL-3.0-only */

/** Saxes and the XML character tables it imports inside maintained workers. */
export const WORKER_XML_VENDOR_CHUNK_TEST = /node_modules[\\/](?:saxes|xmlchars)[\\/]/;

/** Effect metadata and the dependency-closed canonical copy registry used by workers. */
export const WORKER_EFFECT_CONTRACT_CHUNK_TEST = /(?:src[\\/]common[\\/]i18n[\\/](?:canonical-extras(?:-(?:audacity-(?:effects|presets)|standard-effects))?|locale)\.js|src[\\/]common[\\/]editor[\\/]audacity-effects[\\/]audacity-filter-release\.ts|src[\\/]common[\\/]editor[\\/]staffpad[\\/]parameters\.js|src[\\/]common[\\/]editor[\\/]nyquist[\\/]audio-budget\.ts|src[\\/]common[\\/]editor[\\/]first-party-effects[\\/](?:parametric-eq[\\/]coefficients\.ts|standard[\\/](?:definition|filters-definition|filters-coefficients|modulation-definition|noise-gate-definition|delay-definition|delay-pitch-admission|delay-selection-contract|parameter-range|effect-tail|nyquist-replacements|selection-contract)\.ts))$/;

/** @type {import('rolldown').CodeSplittingGroup[]} */
export const workerChunkGroups = [
	{
		// Preview validation and the lazy raster loader both hash retained bytes.
		// A shared leaf must not live in the executable worker registration entry:
		// importing that entry from a lazy chunk can register a second listener.
		name: 'vendor-hashes-worker',
		test: /node_modules[\\/]@noble[\\/]hashes[\\/]/,
		priority: 101,
		minSize: 0,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
	{
		name: 'vendor-sqlite-worker',
		test: /node_modules[\\/]@sqlite\.org[\\/]sqlite-wasm[\\/]/,
		priority: 100,
		maxSize: 400_000,
	},
	{
		// Keep the parser and its character tables under one explicit owner instead
		// of placing either by reachability. Non-recursive ownership keeps future
		// dependency growth from silently broadening this worker vendor surface.
		name: 'vendor-xml-worker',
		test: WORKER_XML_VENDOR_CHUNK_TEST,
		priority: 99,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
	{
		// Archive workers describe imported effects without running their DSP.
		// Keep that shared metadata and its complete copy dependency closure apart
		// from the database protocol, without absorbing their consumers recursively.
		// Delay capacity also reads StaffPad parameters; leaving that leaf unowned
		// creates a cycle back into the worker entry during contract initialization.
		name: 'editor-effect-contracts-worker',
		test: WORKER_EFFECT_CONTRACT_CHUNK_TEST,
		priority: 98,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
];


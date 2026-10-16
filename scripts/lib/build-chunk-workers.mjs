/* SPDX-License-Identifier: AGPL-3.0-only */

/** Saxes and the XML character tables it imports inside maintained workers. */
export const WORKER_XML_VENDOR_CHUNK_TEST = /node_modules[\\/](?:saxes|xmlchars)[\\/]/;

/** Effect metadata and the dependency-closed canonical copy registry used by workers. */
export const WORKER_EFFECT_CONTRACT_CHUNK_TEST = /(?:src[\\/]common[\\/]i18n[\\/](?:canonical-extras(?:-(?:audacity-(?:effects|presets)|standard-effects))?|locale)\.js|src[\\/]common[\\/]editor[\\/]audacity-effects[\\/](?:audacity-filter-release\.ts|manifest\.js)|src[\\/]common[\\/]editor[\\/]staffpad[\\/]parameters\.js|src[\\/]common[\\/]editor[\\/]nyquist[\\/]audio-budget\.ts|src[\\/]common[\\/]editor[\\/]first-party-effects[\\/](?:parametric-eq[\\/](?:coefficients\.ts|definition\.js)|bitcrusher[\\/]definition\.js|standard[\\/](?:definition|filters-definition|filters-coefficients|modulation-definition|noise-gate-definition|delay-definition|delay-pitch-admission|delay-selection-contract|parameter-range|effect-tail|nyquist-replacements|selection-contract)\.ts))$/;

/** Closed authored video-effect contracts and their inert scalar/geometry support.
 * Archive workers validate these recipes without importing UI or pixel consumers. */
export const WORKER_VIDEO_CONTRACT_CHUNK_TEST = /(?:^|[\\/])src[\\/]common[\\/]editor[\\/](?:stable-id\.js|video-effects\.js|(?:closed-domain-value|video-effect-closed-(?:creation|families-v1)|video-global-develop-v1|video-image-geometry-(?:v1|ffmpeg-v1)|video-chroma-develop-v1|video-black-white-mix-v1|video-hsl-mixer-v1|video-curves-v1|video-curve-(?:types|transfer)-v1|video-color-wheels-(?:v1|scalar-v1)|video-sharpen-(?:v1|ffmpeg-v1)|video-post-crop-vignette-(?:v1|ffmpeg-v1)|video-clarity-(?:v1|ffmpeg-v1)|video-noise-reduction-(?:v1|ffmpeg-v1)|video-grain-(?:v1|ffmpeg-v1)|video-texture-(?:v1|ffmpeg-v1)|video-dehaze-(?:v1|ffmpeg-v1)|video-original-alpha-ffmpeg-v1|imaging[\\/](?:image-geometry-v1|image-geometry-plan-v1|pixel-frame-contract-v1))\.ts)$/;

/** @type {import('rolldown').CodeSplittingGroup[]} */
export const workerChunkGroups = [
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
	{
		// Keep shared recipe admission away from the database protocol. Exact
		// static dependencies stay here so initialization never loops through
		// an importing worker entry; new render consumers remain independently owned.
		name: 'editor-video-contracts-worker',
		test: WORKER_VIDEO_CONTRACT_CHUNK_TEST,
		priority: 97,
		minSize: 0,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
	{
		// Both Audacity database generations encode and decode typed XML records.
		// This dependency-closed codec has no imports back into the worker protocol.
		name: 'audacity-binary-xml-worker',
		test: /(?:^|[\\/])src[\\/]common[\\/]editor[\\/]audacity-binary-xml\.js$/,
		priority: 96,
		minSize: 0,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
];

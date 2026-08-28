/* SPDX-License-Identifier: AGPL-3.0-only */

/** Direct product authorities admitted to the Soundscaper 1.0 production graph. */
export const SOUNDSCAPER_BASELINE_ENTRY_MODULES = Object.freeze([
	'desktop-project-library-renderer.ts',
	'desktop-project-library-store-adapter.ts',
	'editor-controller.ts',
	'editor-project.ts',
	'editor-project-commands.ts',
	'editor-project-environment.ts',
	'editor-project-feature-requirements.ts',
	'editor-project-history.ts',
	'editor-project-playback.ts',
	'editor-project-runtime-profile.ts',
	'editor-project-runtime-selection.ts',
	'editor-project-store.ts',
	'editor-scape-assets.ts',
	'editor-scape-native.ts',
	'editor-session-clipboard.ts',
	'video-export-strategy.ts',
	'ui/SoundscaperAudioEditorBootstrap.tsx',
] as const);

/**
 * Closed inventory of versioned Soundscaper modules retained by the baseline.
 * Each row is an independently serialized or externally exchanged contract,
 * never a product-schema implementation generation.
 */
export const SOUNDSCAPER_BASELINE_VERSIONED_BOUNDARIES = Object.freeze([
	boundary(
		'./desktop-native-plugin-state-transport-v1.ts',
		'native-protocol',
		'Preload/main native plug-in state body descriptors are a serialized public v1 transport.',
	),
] as const);

function boundary(
	module: `./${string}.ts`,
	kind: 'native-protocol',
	reason: string,
) {
	return Object.freeze({ module, kind, reason });
}

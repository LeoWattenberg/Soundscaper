/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Turn a product profile's `enabledCommands` list into an explicit composition
 * decision the editor's composition root can act on.
 *
 * `enabledCommands` is the coarse product switch: it names the command families
 * a product ships. Until this module existed the field was declared and read
 * nowhere, so Framescaper composed — and booted — every audio subsystem its own
 * profile says it does not have. The policy lives here rather than inline in
 * `app.js` so that skipping a construction is a decision one module makes and a
 * test can pin, instead of a product check scattered through the wiring.
 *
 * Unknown command names are rejected. That is the guard which keeps the field
 * alive: a profile can no longer name a command family the composition root has
 * never heard of, and a new family cannot be added without deciding here what it
 * composes.
 */

/** Optional subsystem domains the composition root may skip. */
export type OptionalCompositionDomain =
	| 'recording'
	| 'generators'
	| 'labeledAudio'
	| 'effects'
	| 'spectral'
	| 'analysis'
	| 'macros';

export interface ProductCompositionDecision {
	/** Live audio capture: the recording pool, routing, take cycle and timed recording. */
	readonly recording: boolean;
	/** Tone, noise, chirp and silence generation. */
	readonly generators: boolean;
	/**
	 * Labeled-audio silence generation. It rides the generator command because the
	 * labeled-silence generator lives in the generator service; the labeled-audio
	 * clipboard port stays composed with the always-present edit service.
	 */
	readonly labeledAudio: boolean;
	/** Audacity selection effects, the Nyquist host and effect execution. */
	readonly effects: boolean;
	/** Spectral selection editing. */
	readonly spectral: boolean;
	/** Analyze-menu reports: spectrum, clipping, contrast and loudness. */
	readonly analysis: boolean;
	/** Effect macro authoring and playback. */
	readonly macros: boolean;
	/**
	 * The selection-effect worker pool, which both the effect and the spectral
	 * domain drive. Derived here so no consumer has to restate the rule.
	 */
	readonly selectionEffectWorkers: boolean;
}

export interface ProductCompositionProfile {
	readonly enabledCommands: readonly string[];
}

/** Command families that switch an optional subsystem domain on. */
const OPTIONAL_DOMAINS_BY_COMMAND: Readonly<Record<string, readonly OptionalCompositionDomain[]>> = Object.freeze({
	'audio-record': Object.freeze(['recording'] as const),
	'audio-generate': Object.freeze(['generators', 'labeledAudio'] as const),
	'audio-effects': Object.freeze(['effects'] as const),
	'audio-spectral': Object.freeze(['spectral'] as const),
	'audio-analysis': Object.freeze(['analysis'] as const),
	'audio-macros': Object.freeze(['macros'] as const),
});

/**
 * Command families every product composes unconditionally. They are listed so
 * that an unrecognised command name is an error rather than a silent no-op.
 */
const UNCONDITIONAL_COMMANDS: readonly string[] = Object.freeze([
	'project',
	'timeline',
	'transport',
	'audio-mix',
	'video-basic',
	'video-effects',
	'video-compositing',
	'export-audio',
	'export-video',
]);

/** Every command family a product profile may name. */
export const KNOWN_PRODUCT_COMMANDS: readonly string[] = Object.freeze([
	...Object.keys(OPTIONAL_DOMAINS_BY_COMMAND),
	...UNCONDITIONAL_COMMANDS,
].sort());

/** Every optional subsystem domain the composition root can skip. */
export const OPTIONAL_COMPOSITION_DOMAINS: readonly OptionalCompositionDomain[] = Object.freeze([
	'recording', 'generators', 'labeledAudio', 'effects', 'spectral', 'analysis', 'macros',
]);

export function resolveProductCompositionDecision(
	profile: ProductCompositionProfile,
): Readonly<ProductCompositionDecision> {
	const enabled = new Set(profile.enabledCommands);
	for (const command of enabled) {
		if (!KNOWN_PRODUCT_COMMANDS.includes(command)) {
			throw new RangeError(
				`Product command "${command}" is not a composition domain the editor knows.`,
			);
		}
	}
	const composed = new Set<OptionalCompositionDomain>();
	for (const [command, domains] of Object.entries(OPTIONAL_DOMAINS_BY_COMMAND)) {
		if (!enabled.has(command)) continue;
		for (const domain of domains) composed.add(domain);
	}
	const effects = composed.has('effects');
	const spectral = composed.has('spectral');
	return Object.freeze({
		recording: composed.has('recording'),
		generators: composed.has('generators'),
		labeledAudio: composed.has('labeledAudio'),
		effects,
		spectral,
		analysis: composed.has('analysis'),
		macros: composed.has('macros'),
		selectionEffectWorkers: effects || spectral,
	});
}

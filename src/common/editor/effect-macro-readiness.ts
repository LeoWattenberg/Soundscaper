/* SPDX-License-Identifier: AGPL-3.0-only */

/** Noise Reduction in a macro is portable only when its profile travels with the draft. */
export function effectMacroMissingEmbeddedNoiseProfile(
	effects: readonly Readonly<{
		readonly type?: unknown;
		readonly enabled?: unknown;
		readonly context?: Readonly<Record<string, unknown>>;
	}>[],
): boolean {
	return effects.some((effect) => effect.enabled !== false
		&& effect.type === 'audacity-noise-reduction'
		&& !isRecord(effect.context?.noiseProfile));
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * An OpenFX effect names project identities directly: every declared input points
 * at one, and a frozen fallback points at the external media it rendered. A Scape
 * import that re-mints colliding source identities has to follow both, or the
 * imported document keeps naming sources that no longer exist and fails to load
 * on the missing identity. An input that names something other than a source -
 * a clip or a track - is not in the map and keeps the identity it had.
 */
export function rebindFramescaperSourceIdentitiesOpenFx(
	project: Record<string, unknown>,
	sourceIdMap: ReadonlyMap<string, string>,
): void {
	if (!Array.isArray(project.ofxEffects)) return;
	project.ofxEffects = (project.ofxEffects as Record<string, unknown>[]).map((effect) => ({
		...effect,
		...(Array.isArray(effect.inputs) ? {
			inputs: (effect.inputs as Record<string, unknown>[]).map((input) => ({
				...input,
				sourceRef: rebound(input.sourceRef, sourceIdMap),
			})),
		} : {}),
		...(isRecord(effect.frozenFallback) ? {
			frozenFallback: {
				...effect.frozenFallback,
				externalMediaSourceId: rebound(effect.frozenFallback.externalMediaSourceId, sourceIdMap),
			},
		} : {}),
	}));
}

function rebound(value: unknown, sourceIdMap: ReadonlyMap<string, string>): unknown {
	return typeof value === 'string' ? sourceIdMap.get(value) ?? value : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

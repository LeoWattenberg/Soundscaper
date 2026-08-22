/* SPDX-License-Identifier: AGPL-3.0-only */

import { rebindFramescaperProfessionalMediaSourceIdentitiesV25 } from './editor-project-v25-source-rebind.ts';

/** Follow Scape collision remaps through V26 named inputs and external freezes. */
export function rebindFramescaperOpenFxSourceIdentitiesV26(
	project: Record<string, unknown>,
	sourceIdMap: ReadonlyMap<string, string>,
): void {
	rebindFramescaperProfessionalMediaSourceIdentitiesV25(project, sourceIdMap);
	if (![...sourceIdMap].some(([before, after]) => before !== after)
		|| !Array.isArray(project.ofxEffects)) return;
	project.ofxEffects = (project.ofxEffects as Record<string, unknown>[]).map((value) => {
		const effect = structuredClone(value) as Record<string, unknown>;
		if (effect.attachment && typeof effect.attachment === 'object' && !Array.isArray(effect.attachment)) {
			const attachment = effect.attachment as Record<string, unknown>;
			attachment.targetId = sourceIdMap.get(String(attachment.targetId)) ?? attachment.targetId;
		}
		if (Array.isArray(effect.inputs)) {
			effect.inputs = (effect.inputs as Record<string, unknown>[]).map((input) => ({
				...input,
				sourceRef: sourceIdMap.get(String(input.sourceRef)) ?? input.sourceRef,
			}));
		}
		if (effect.frozenFallback && typeof effect.frozenFallback === 'object'
			&& !Array.isArray(effect.frozenFallback)) {
			const fallback = effect.frozenFallback as Record<string, unknown>;
			fallback.externalMediaSourceId = sourceIdMap.get(String(fallback.externalMediaSourceId))
				?? fallback.externalMediaSourceId;
		}
		return effect;
	});
}

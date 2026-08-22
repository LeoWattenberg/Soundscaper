/* SPDX-License-Identifier: AGPL-3.0-only */

import type { OfxEffectStateV26 } from '../common/editor/native-ofx-state-v26.ts';
import type { UnifiedExactRenderOpenFxNode } from '../common/editor/unified-exact-render-plan.ts';
import {
	generatedNodeId,
	type FramescaperUnifiedRenderFoundation,
} from './editor-project-unified-render-core.ts';

/** Select active attachment owners and retain every byte of their V26 state. */
export function createFramescaperUnifiedOpenFxRenderNodes(
	foundation: FramescaperUnifiedRenderFoundation,
	representedIdentities: ReadonlySet<string>,
): readonly UnifiedExactRenderOpenFxNode[] {
	const effects = foundation.project.ofxEffects;
	if (!Array.isArray(effects)) throw new TypeError('A V26 project must own an ofxEffects array.');
	const active = effects
		.map((value, index) => record(value, `ofxEffects[${String(index)}]`) as unknown as OfxEffectStateV26)
		.filter(({ attachment }) => representedIdentities.has(attachment.targetId))
		.sort((left, right) => compareText(left.instanceId, right.instanceId));
	for (const state of active) {
		for (const input of state.inputs) {
			if (!representedIdentities.has(input.sourceRef)) {
				throw new ReferenceError(
					`Active OpenFX input ${input.name} references ${input.sourceRef}, which is not represented in the render graph.`,
				);
			}
		}
		if (state.frozenFallback !== null
			&& !representedIdentities.has(state.frozenFallback.externalMediaSourceId)) {
			throw new ReferenceError('Active OpenFX frozen fallback is not represented in the render graph.');
		}
	}
	return Object.freeze(active.map((state): UnifiedExactRenderOpenFxNode => Object.freeze({
		kind: 'openfx' as const,
		nodeId: generatedNodeId('openfx', state.instanceId, foundation.projectIdentities),
		state,
	})));
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Record<string, unknown>;
}

function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }

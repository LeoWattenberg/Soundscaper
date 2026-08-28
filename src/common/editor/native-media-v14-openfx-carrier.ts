/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact OpenFX family whose named input is the selected Web carrier itself. */

import { nativeMediaV14RenderFamily } from './native-media-v14-render-family.ts';
import type {
	UnifiedExactRenderOpenFxNode,
	UnifiedExactRenderPlan,
	UnifiedExactRenderPlanV14,
} from './unified-exact-render-plan.ts';

/**
 * Return the one supported filter, or null when graph planes beyond the final
 * carrier would be required. Removing the node must leave a single-source,
 * full-frame, identity-finishing picture; audio is staged independently.
 */
export function nativeMediaV14OpenFxCarrierFilter(
	plan: UnifiedExactRenderPlanV14,
): UnifiedExactRenderOpenFxNode | null {
	const nodes = plan.nodes.filter(
		(node): node is UnifiedExactRenderOpenFxNode => node.kind === 'openfx',
	);
	if (nodes.length !== 1) return null;
	const node = nodes[0]!;
	const state = node.state;
	const clip = plan.nodes.find((candidate) => candidate.kind === 'clip');
	if (!clip || !state.enabled || state.context !== 'filter' || state.frozenFallback !== null
		|| state.attachment.targetId !== clip.clipId || state.inputs.length !== 1
		|| state.inputs[0]?.name !== 'Source'
		|| state.inputs[0]?.sourceRef !== plan.sources[0]?.sourceId) return null;
	const foundation = {
		...plan,
		output: { ...plan.output, includeAudio: false as const, audioLayout: null },
		nodes: plan.nodes.filter(({ kind }) => kind !== 'openfx'),
	} as UnifiedExactRenderPlan;
	if (nativeMediaV14RenderFamily(foundation) === 'single-full-frame-clip-v1') return node;
	const finishing = foundation.nodes.find((candidate) => candidate.kind === 'finishing');
	const interpretation = finishing?.kind === 'finishing' ? finishing.sourceInterpretations[0] : null;
	if (!finishing || finishing.kind !== 'finishing'
		|| finishing.colorContext.outputSpace !== 'rec709'
		|| finishing.sourceInterpretations.length !== 1
		|| !interpretation || interpretation.sourceId !== foundation.sources[0]?.sourceId
		|| interpretation.primaries !== 'bt709' || interpretation.transfer !== 'bt709'
		|| interpretation.matrix !== 'rgb' || interpretation.range !== 'full'
		|| interpretation.provenance !== 'user-override') return null;
	// For every 8-bit channel, the selected V13 full-range BT.709 decode and
	// Rec.709 encode round-trip to the same byte. Projecting only its provenance
	// lets the existing closed identity-family authority verify all remaining
	// picture, timing, topology, professional, and finishing invariants.
	const identityProjection = {
		...foundation,
		nodes: foundation.nodes.map((candidate) => candidate.kind !== 'finishing' ? candidate : ({
			...candidate,
			sourceInterpretations: candidate.sourceInterpretations.map((value) => ({
				...value, provenance: 'legacy-unmanaged-encoded' as const,
			})),
		})),
	} as UnifiedExactRenderPlan;
	return nativeMediaV14RenderFamily(identityProjection) === 'single-full-frame-clip-v1'
		? node : null;
}

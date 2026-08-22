/* SPDX-License-Identifier: AGPL-3.0-only */

import type { UnifiedExactRenderProfessionalMediaNode } from '../common/editor/unified-exact-render-plan.ts';
import {
	generatedNodeId,
	type FramescaperUnifiedRenderFoundation,
} from './editor-project-unified-render-core.ts';

/** Project V25 source state projected onto complete V11 professional nodes. */
export function createFramescaperUnifiedProfessionalRenderNodes(
	foundation: FramescaperUnifiedRenderFoundation,
): readonly UnifiedExactRenderProfessionalMediaNode[] {
	const sources = [...foundation.sourceById.values()]
		.filter(({ kind }) => kind === 'video')
		.sort(compareIds);
	return Object.freeze(sources.map((source): UnifiedExactRenderProfessionalMediaNode => {
		const sourceId = String(source.id);
		const sourceNodeId = foundation.sourceNodeIdById.get(sourceId);
		if (!sourceNodeId) throw new ReferenceError(`Professional source ${sourceId} has no exact input node.`);
		if (!Object.hasOwn(source, 'characteristics') || !Object.hasOwn(source, 'imageSequence')
			|| !Object.hasOwn(source, 'proxyAttachment')) {
			throw new TypeError(`Professional source ${sourceId} is missing cumulative V25 authority.`);
		}
		return Object.freeze({
			kind: 'professional-media' as const,
			nodeId: generatedNodeId('professional', sourceId, foundation.projectIdentities),
			sourceNodeId,
			characteristics: source.characteristics as
				UnifiedExactRenderProfessionalMediaNode['characteristics'],
			imageSequence: source.imageSequence as
				UnifiedExactRenderProfessionalMediaNode['imageSequence'],
			proxyAttachment: source.proxyAttachment as
				UnifiedExactRenderProfessionalMediaNode['proxyAttachment'],
			exportAuthority: 'original' as const,
		});
	}));
}

function compareIds(
	left: Readonly<Record<string, unknown>>,
	right: Readonly<Record<string, unknown>>,
): number {
	const a = String(left.id);
	const b = String(right.id);
	return a < b ? -1 : a > b ? 1 : 0;
}

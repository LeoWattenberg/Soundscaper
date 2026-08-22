/* SPDX-License-Identifier: AGPL-3.0-only */

import { createUnifiedExactRenderPlan } from '../../src/common/editor/unified-exact-render-plan.ts';
import { unifiedExactPlanFixture } from './unified-exact-render-plan-fixture.ts';

export function mediaHostUnifiedPlan(sourceSha256) {
	return mediaHostUnifiedPlanGeneration(9, sourceSha256);
}

export function mediaHostUnifiedPlanGeneration(version, sourceSha256) {
	const plan = structuredClone(unifiedExactPlanFixture(version));
	plan.sources[0].contentSha256 = sourceSha256;
	plan.sources[0].storageKey = version >= 11
		? `image-sequence-pack-sha256:${sourceSha256}` : 'media/source-1';
	const visual = plan.nodes.find(({ kind }) => kind === 'visual');
	if (visual?.authoredFallback) {
		visual.authoredFallback.renderedAssetSha256 = sourceSha256;
		visual.frozenFallback.renderedAssetSha256 = sourceSha256;
	}
	const professional = plan.nodes.find(({ kind }) => kind === 'professional-media');
	if (professional) {
		professional.imageSequence.sourcePack.storageKey = `image-sequence-pack-sha256:${sourceSha256}`;
		professional.imageSequence.sourcePack.sha256 = sourceSha256;
		professional.proxyAttachment.originalSha256 = sourceSha256;
	}
	const openFx = plan.nodes.find(({ kind }) => kind === 'openfx');
	if (openFx?.state.frozenFallback) {
		openFx.state.frozenFallback.renderedAssetSha256 = sourceSha256;
	}
	return createUnifiedExactRenderPlan(plan);
}

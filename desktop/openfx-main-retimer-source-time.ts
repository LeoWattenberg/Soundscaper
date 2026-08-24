/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-owned reconstitution of the opaque OFX Retimer SourceTime authority. */

import {
	createUnifiedExactRenderOfxRetimerSourceTime,
} from '../src/common/editor/unified-exact-render-plan-consumers.ts';
import type {
	UnifiedExactRenderClipNode,
	UnifiedExactRenderPlanV14,
} from '../src/common/editor/unified-exact-render-plan.ts';
import {
	bindVideoSourceTimingView,
	type BoundVideoSourceTimingView,
	type VideoSourceTimingView,
} from '../src/common/editor/video-source-timing-view.ts';
import {
	validateVideoTimingAssetBytes,
} from '../src/common/editor/video-timing-asset.ts';
import type { NativePlanVideoTimingAssetBytes } from './native-services-video-timing-staging.ts';

export function createOpenFxMainRetimerSourceTimeV1(options: Readonly<{
	readonly plan: UnifiedExactRenderPlanV14;
	readonly instanceId: string;
	readonly outputOrdinal: number;
	readonly timingAssets: readonly NativePlanVideoTimingAssetBytes[];
}>) {
	const plan = options.plan;
	const effect = plan.nodes.find((node) => node.kind === 'openfx'
		&& node.state.instanceId === options.instanceId);
	if (!effect || effect.kind !== 'openfx' || effect.state.context !== 'retimer') {
		throw new ReferenceError('Main-owned SourceTime requires one exact V14 Retimer node.');
	}
	const clip = plan.nodes.find((node): node is UnifiedExactRenderClipNode => (
		node.kind === 'clip' && node.clipId === effect.state.attachment.targetId
	));
	if (!clip) throw new ReferenceError('Main-owned SourceTime requires the attached V14 clip.');
	const requiredSourceIds = new Set(clip.sourceTimeMapping.intent.intersections.map(({ sourceId }) => sourceId));
	const byInput = new Map(options.timingAssets.map((asset) => [asset.input.sourceId, asset]));
	const timing = new Map<string, BoundVideoSourceTimingView>();
	for (const sourceId of [...requiredSourceIds].sort(compareText)) {
		const source = plan.sources.find((candidate) => candidate.sourceId === sourceId);
		if (!source) throw new ReferenceError(`OpenFX Retimer source ${sourceId} is unavailable.`);
		const sourceClip = plan.nodes.find((node): node is UnifiedExactRenderClipNode => (
			node.kind === 'clip' && node.sourceNodeId === source.nodeId
			&& node.sourceTimeMapping.intent.intersections.some((row) => row.sourceId === sourceId)
		));
		if (!sourceClip) throw new ReferenceError(`OpenFX Retimer rate for ${sourceId} is unavailable.`);
		const rate = sourceClip.sourceTimeMapping.sourceRate;
		let view: VideoSourceTimingView;
		if (source.timing.kind === 'cfr') {
			view = Object.freeze({ kind: 'cfr' as const, rate: source.timing.rate, frameCount: source.timing.frameCount });
		} else {
			const asset = byInput.get(sourceId);
			if (!asset) throw new ReferenceError(`OpenFX Retimer timing bytes for ${sourceId} are unavailable.`);
			const index = validateVideoTimingAssetBytes(source.timing.reference, asset.bytes);
			view = Object.freeze({ kind: 'vfr' as const, reference: source.timing.reference, index });
		}
		const frameCount = source.timing.kind === 'cfr'
			? source.timing.frameCount : source.timing.reference.frameCount;
		const sourceRecord = Object.freeze({
			id: sourceId, kind: 'video' as const, contentSha256: source.contentSha256,
			frameRate: rate, sourceFrameCount: frameCount,
			timingAsset: source.timing.kind === 'vfr' ? source.timing.reference : null,
			timingDecision: Object.freeze({
				mode: source.timing.kind === 'vfr' ? 'exact' as const : 'conform-cfr-at-ingest' as const,
				rate,
			}),
		});
		timing.set(sourceId, bindVideoSourceTimingView(new Map([[sourceId, view]]), sourceRecord));
	}
	return createUnifiedExactRenderOfxRetimerSourceTime(
		plan, options.instanceId, options.outputOrdinal, timing,
	);
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

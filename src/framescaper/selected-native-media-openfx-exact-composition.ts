/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	addUnifiedExactLinearCompositionEntryV13,
	type UnifiedExactLinearCompositionEntryV13,
	type UnifiedExactLinearPremultipliedFrameV13,
} from '../common/editor/unified-exact-linear-rgba-v13.ts';
import type { OfxContext } from '../common/editor/native-ofx-descriptor.ts';
import type { FramescaperOpenFxFrameDispositionNativeMedia } from './editor-openfx-frame-graph-native-media.ts';
import type { UnifiedExactRenderPlanV13 } from '../common/editor/unified-exact-render-plan.ts';
import type { UnifiedExactRenderVisualRgbaV13 } from '../common/editor/unified-exact-render-visual-materializer-v13.ts';
import { evaluateVideoMaskMatteRgbaV13 } from '../common/editor/video-mask-matte-rgba-v13.ts';
import {
	framescaperOpenFxLinearPlaneNativeMedia,
	framescaperOpenFxRgbaPlaneNativeMedia,
	type FramescaperSelectedOpenFxExactPlanesNativeMedia,
} from './selected-native-media-openfx-exact-planes.ts';

interface TransitionWeight {
	readonly clipId: string;
	readonly transitionId: string;
	readonly weight: number;
}

export interface FramescaperSelectedOpenFxCompositionNativeMedia {
	omitsDefaultClip(clipId: string): boolean;
	clip(
		frame: UnifiedExactLinearPremultipliedFrameV13,
		clipId: string,
		sourceId: string,
	): Promise<UnifiedExactLinearPremultipliedFrameV13>;
	visual(
		frame: UnifiedExactLinearPremultipliedFrameV13,
		clipId: string,
		sourceId: string,
	): Promise<UnifiedExactLinearPremultipliedFrameV13>;
	adjustment(
		frame: UnifiedExactLinearPremultipliedFrameV13,
		adjustmentId: string,
	): Promise<UnifiedExactLinearPremultipliedFrameV13>;
	applyTransitions(
		tracks: Map<string, UnifiedExactLinearCompositionEntryV13[]>,
	): Promise<void>;
	disposition(): Readonly<{
		readonly effects: readonly FramescaperOpenFxFrameDispositionNativeMedia[];
		readonly reportsDegradation: boolean;
	}>;
}

export function createFramescaperSelectedOpenFxCompositionNativeMedia(options: Readonly<{
	readonly planes: FramescaperSelectedOpenFxExactPlanesNativeMedia;
	readonly plan: UnifiedExactRenderPlanV13;
	readonly outputOrdinal: number;
	readonly transitionWeights: readonly TransitionWeight[];
	readonly maskGraphs: ReadonlyMap<string, unknown>;
	readonly maskInputs: ReadonlyMap<string, UnifiedExactRenderVisualRgbaV13>;
	readonly initialPlanes: ReadonlyMap<string, UnifiedExactRenderVisualRgbaV13>;
	readonly width: number;
	readonly height: number;
	readonly signal: AbortSignal;
}>): FramescaperSelectedOpenFxCompositionNativeMedia {
	const registry = new Map<string, UnifiedExactLinearPremultipliedFrameV13>();
	const dispositions: FramescaperOpenFxFrameDispositionNativeMedia[] = [];
	const initial = new Map([...options.initialPlanes].map(([identity, frame]) => (
		[identity, framescaperOpenFxRgbaPlaneNativeMedia(identity, frame)] as const
	)));
	const activeTransitions = transitionEntries(options);
	const participants = new Set(activeTransitions.flatMap(({ outgoingClipId, incomingClipId }) => (
		[outgoingClipId, incomingClipId]
	)));
	const clip = async (frame: UnifiedExactLinearPremultipliedFrameV13, clipId: string, sourceId: string) => {
		registry.set(sourceId, frame);
		const output = await contexts(frame, sourceId, clipId, ['retimer', 'paint', 'filter']);
		registry.set(clipId, output);
		return output;
	};
	const visual = async (frame: UnifiedExactLinearPremultipliedFrameV13, clipId: string, sourceId: string) => {
		registry.set(sourceId, frame);
		let output = await contexts(frame, sourceId, sourceId, ['generator', 'general']);
		output = await contexts(output, sourceId, clipId, ['paint', 'filter']);
		registry.set(clipId, output);
		return output;
	};
	async function adjustment(frame: UnifiedExactLinearPremultipliedFrameV13, adjustmentId: string) {
		registry.set(adjustmentId, frame);
		const output = await contexts(frame, adjustmentId, adjustmentId, ['filter']);
		registry.set(adjustmentId, output);
		return output;
	}
	async function contexts(
		frame: UnifiedExactLinearPremultipliedFrameV13,
		primaryIdentity: string,
		targetId: string,
		values: readonly OfxContext[],
	) {
		let output = frame;
		for (const context of values) {
			if (!options.planes.has(context, targetId)) continue;
			registry.set(primaryIdentity, output);
			const named = options.planes.inputs(context, targetId).filter((identity) => identity !== primaryIdentity)
				.map((identity) => requiredPlane(identity));
			const applied = await options.planes.apply({
				context, targetId, outputOrdinal: options.outputOrdinal,
				primary: framescaperOpenFxLinearPlaneNativeMedia(primaryIdentity, output), named,
				signal: options.signal,
			});
			dispositions.push(...applied.dispositions); output = applied.frame;
		}
		return output;
	}
	function requiredPlane(identity: string) {
		const existing = registry.get(identity);
		if (existing) return framescaperOpenFxLinearPlaneNativeMedia(identity, existing);
		const original = initial.get(identity);
		if (original) return original;
		const graph = options.maskGraphs.get(identity);
		if (!graph) throw new ReferenceError(`OpenFX named intermediate plane ${identity} is unavailable.`);
		const alpha = evaluateVideoMaskMatteRgbaV13(
			graph, options.width, options.height, options.maskInputs,
		);
		const pixels = new Uint8Array(options.width * options.height * 4);
		for (let index = 0; index < alpha.length; index += 1) {
			const offset = index * 4;
			pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = pixels[offset + 3] = alpha[index]!;
		}
		return framescaperOpenFxRgbaPlaneNativeMedia(identity, Object.freeze({
			width: options.width, height: options.height, pixels,
		}));
	}
	async function applyTransitions(tracks: Map<string, UnifiedExactLinearCompositionEntryV13[]>) {
		for (const transition of activeTransitions) {
			const outgoing = registry.get(transition.outgoingClipId);
			const incoming = registry.get(transition.incomingClipId);
			if (!outgoing || !incoming) throw new ReferenceError('OpenFX Transition lost one exact participant plane.');
			const result = await options.planes.apply({
				context: 'transition', targetId: transition.id,
				outputOrdinal: options.outputOrdinal, primary: null,
				named: Object.freeze([
					framescaperOpenFxLinearPlaneNativeMedia(transition.outgoingClipId, outgoing),
					framescaperOpenFxLinearPlaneNativeMedia(transition.incomingClipId, incoming),
				]),
				transitionProgress: options.planes.transition(transition.id, options.outputOrdinal),
				signal: options.signal,
			});
			const entries = tracks.get(transition.trackId) ?? [];
			dispositions.push(...result.dispositions);
			addUnifiedExactLinearCompositionEntryV13(entries, result.frame, 'normal');
			tracks.set(transition.trackId, entries);
		}
	}
	return Object.freeze({
		omitsDefaultClip: (clipId: string) => participants.has(clipId),
		clip, visual, adjustment, applyTransitions,
		disposition: () => Object.freeze({
			effects: Object.freeze([...dispositions]),
			reportsDegradation: dispositions.some(({ reportsDegradation }) => reportsDegradation),
		}),
	});
}

function transitionEntries(options: Readonly<{
	readonly planes: FramescaperSelectedOpenFxExactPlanesNativeMedia;
	readonly plan: UnifiedExactRenderPlanV13;
	readonly transitionWeights: readonly TransitionWeight[];
}>) {
	const active = new Set(options.transitionWeights.map(({ transitionId }) => transitionId));
	return Object.freeze(options.plan.nodes.flatMap((node) => node.kind === 'transition'
		&& active.has(node.transition.id) && options.planes.has('transition', node.transition.id)
		? [Object.freeze({ id: node.transition.id, trackId: node.edges.trackId,
			outgoingClipId: node.edges.outgoing.clipId, incomingClipId: node.edges.incoming.clipId })]
		: []));
}

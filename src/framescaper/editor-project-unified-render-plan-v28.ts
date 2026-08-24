/* SPDX-License-Identifier: AGPL-3.0-only */

import type { UnifiedExactRenderFinishingNode, UnifiedExactRenderPlanV14 } from '../common/editor/unified-exact-render-plan.ts';
import {
	snapshotFramescaperUnifiedExactVisualRenderAuthority,
	type FramescaperUnifiedExactVisualRenderAuthority,
} from './editor-project-unified-render-authority.ts';
import {
	createFramescaperUnifiedRenderFoundation,
	finalizeFramescaperUnifiedRenderPlan,
	generatedNodeId,
} from './editor-project-unified-render-core.ts';
import { createFramescaperUnifiedOpenFxRenderNodes } from './editor-project-unified-render-openfx.ts';
import {
	framescaperV28NativeDeliveryProfile,
	snapshotFramescaperNativeRenderDeliveryRequestV28,
	type FramescaperNativeRenderDeliveryRequestV28,
} from './editor-native-project-action-requests-v28.ts';
import { createFramescaperUnifiedProfessionalRenderNodes } from './editor-project-unified-render-professional.ts';
import { createFramescaperUnifiedVisualRenderNodes } from './editor-project-unified-render-visual.ts';
import { validateFramescaperProjectV28, type FramescaperProjectV28 } from './editor-project-v28.ts';

export type { FramescaperUnifiedExactVisualRenderAuthority };

/** V14 is the first selected plan joining finishing, professional media, and OFX. */
export function createFramescaperProjectUnifiedExactRenderPlanV28(
	profile: unknown,
	projectValue: unknown,
	authorityValue: unknown,
	deliveryValue?: FramescaperNativeRenderDeliveryRequestV28,
): UnifiedExactRenderPlanV14 {
	validateFramescaperProjectV28(profile, projectValue);
	const project = projectValue as FramescaperProjectV28;
	const authority = snapshotFramescaperUnifiedExactVisualRenderAuthority(authorityValue);
	const foundation = createFramescaperUnifiedRenderFoundation(project, authority, 14);
	const visual = createFramescaperUnifiedVisualRenderNodes(foundation, authority);
	const professional = createFramescaperUnifiedProfessionalRenderNodes(foundation);
	const openFx = createFramescaperUnifiedOpenFxRenderNodes(foundation, visual.representedIdentities);
	const finishing = createFinishingNode(project, foundation.projectIdentities, authority.sequenceId);
	const delivery = snapshotFramescaperNativeRenderDeliveryRequestV28(deliveryValue);
	return finalizeFramescaperUnifiedRenderPlan(
		foundation, 14, [...visual.nodes, ...professional, ...openFx, finishing],
		framescaperV28NativeDeliveryProfile(delivery),
	) as UnifiedExactRenderPlanV14;
}

function createFinishingNode(
	project: FramescaperProjectV28,
	projectIdentities: ReadonlySet<string>,
	sequenceId: string,
): UnifiedExactRenderFinishingNode {
	const colorContexts = project.videoColorContexts.filter((context) => context.sequenceId === sequenceId);
	if (colorContexts.length !== 1) throw new ReferenceError('V28 render requires exactly one sequence color context.');
	const audioTracks = records(project.tracks, 'V28 render tracks').filter(({ type }) => type === 'audio')
		.map((track) => ({ id: String(track.id), effectIds: effectIds(track.effects) })).sort(compareIds);
	const master = record(project.master, 'V28 render master');
	return {
		kind: 'finishing', nodeId: generatedNodeId('finishing', sequenceId, projectIdentities), sequenceId,
		colorContext: colorContexts[0]!,
		sourceInterpretations: [...project.videoSourceColorInterpretations].sort(compareSourceIds),
		visualPresentations: [...project.videoVisualPresentations].sort(compareIds),
		processorStacks: [...project.videoProcessorStacks].sort(compareIds),
		motionAnalyses: [...project.videoMotionAnalyses].sort(compareIds),
		captionTracks: project.videoCaptionTracks.filter((track) => track.sequenceId === sequenceId).sort(compareIds),
		captionDisposition: 'sidecar-only',
		audioContext: {
			audioTracks, masterEffectIds: effectIds(master.effects),
			masterChannels: positiveInteger(project.masterChannels, 'V28 render master channels'),
			automationLanes: [...project.automationLanes].sort(compareIds), mixer: project.mixer,
		},
	};
}

function effectIds(value: unknown): string[] {
	if (!Array.isArray(value)) throw new TypeError('V28 render audio effects must be an array.');
	return value.map((effect, index) => String(record(effect, `audio effect ${String(index)}`).id)).sort();
}
function positiveInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) throw new RangeError(`${name} must be positive.`);
	return Number(value);
}
function compareIds(left: Readonly<{ id: string }>, right: Readonly<{ id: string }>): number { return left.id.localeCompare(right.id); }
function compareSourceIds(left: Readonly<{ sourceId: string }>, right: Readonly<{ sourceId: string }>): number { return left.sourceId.localeCompare(right.sourceId); }
function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Record<string, unknown>;
}
function records(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => record(item, `${name}[${String(index)}]`));
}

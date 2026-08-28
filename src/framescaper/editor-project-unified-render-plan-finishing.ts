/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	UnifiedExactRenderFinishingNode,
	UnifiedExactRenderPlanV13,
} from '../common/editor/unified-exact-render-plan.ts';
import {
	snapshotFramescaperUnifiedExactVisualRenderAuthority,
	type FramescaperUnifiedExactVisualRenderAuthority,
} from './editor-project-unified-render-authority.ts';
import {
	createFramescaperUnifiedRenderFoundation,
	finalizeFramescaperUnifiedRenderPlan,
	generatedNodeId,
} from './editor-project-unified-render-core.ts';
import { createFramescaperUnifiedVisualRenderNodes } from './editor-project-unified-render-visual.ts';
import { validateFramescaperProjectFinishing, type FramescaperProjectFinishing } from './editor-project-finishing.ts';

export type { FramescaperUnifiedExactVisualRenderAuthority };

/** Adapt selected finishing directly from visual visual lineage into exact V13 authority. */
export function createFramescaperProjectUnifiedExactRenderPlanFinishing(
	profile: unknown,
	projectValue: unknown,
	authorityValue: unknown,
): UnifiedExactRenderPlanV13 {
	validateFramescaperProjectFinishing(profile, projectValue);
	const project = projectValue as FramescaperProjectFinishing;
	const authority = snapshotFramescaperUnifiedExactVisualRenderAuthority(authorityValue);
	const foundation = createFramescaperUnifiedRenderFoundation(project, authority);
	const visual = createFramescaperUnifiedVisualRenderNodes(foundation, authority);
	const finishing = createFinishingNode(project, foundation.projectIdentities, authority.sequenceId);
	const plan = finalizeFramescaperUnifiedRenderPlan(
		foundation, 13, [...visual.nodes, finishing],
	);
	return plan;
}

function createFinishingNode(
	project: FramescaperProjectFinishing,
	projectIdentities: ReadonlySet<string>,
	sequenceId: string,
): UnifiedExactRenderFinishingNode {
	const colorContexts = project.videoColorContexts.filter((context) => context.sequenceId === sequenceId);
	if (colorContexts.length !== 1) throw new ReferenceError('finishing render requires exactly one sequence color context.');
	const audioTracks = records(project.tracks, 'finishing render tracks').filter((track) => track.type === 'audio')
		.map((track) => ({
			id: String(track.id),
			effectIds: effectIds(track.effects),
		})).sort(compareIds);
	const master = record(project.master, 'finishing render master');
	return {
		kind: 'finishing',
		nodeId: generatedNodeId('finishing', sequenceId, projectIdentities),
		sequenceId,
		colorContext: colorContexts[0]!,
		sourceInterpretations: [...project.videoSourceColorInterpretations].sort(compareSourceIds),
		visualPresentations: [...project.videoVisualPresentations].sort(compareIds),
		processorStacks: [...project.videoProcessorStacks].sort(compareIds),
		motionAnalyses: [...project.videoMotionAnalyses].sort(compareIds),
		captionTracks: project.videoCaptionTracks
			.filter((track) => track.sequenceId === sequenceId).sort(compareIds),
		captionDisposition: 'sidecar-only',
		audioContext: {
			audioTracks,
			masterEffectIds: effectIds(master.effects),
			masterChannels: positiveInteger(project.masterChannels, 'finishing render master channels'),
			automationLanes: [...project.automationLanes].sort(compareIds),
			mixer: project.mixer,
		},
	};
}

function effectIds(value: unknown): string[] {
	if (!Array.isArray(value)) throw new TypeError('finishing render audio effects must be an array.');
	return value.map((effect, index) => {
		if (!effect || typeof effect !== 'object' || Array.isArray(effect)
			|| typeof (effect as Readonly<Record<string, unknown>>).id !== 'string') {
			throw new TypeError(`finishing render audio effect ${String(index)} requires an identity.`);
		}
		return String((effect as Readonly<Record<string, unknown>>).id);
	}).sort((left, right) => left.localeCompare(right));
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Record<string, unknown>;
}

function records(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => record(item, `${name}[${String(index)}]`));
}

function positiveInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) throw new RangeError(`${name} must be positive.`);
	return Number(value);
}

function compareIds(left: Readonly<{ id: string }>, right: Readonly<{ id: string }>): number {
	return left.id.localeCompare(right.id);
}

function compareSourceIds(
	left: Readonly<{ sourceId: string }>,
	right: Readonly<{ sourceId: string }>,
): number {
	return left.sourceId.localeCompare(right.sourceId);
}

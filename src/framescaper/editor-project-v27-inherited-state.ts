/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	defaultVideoSourceColorInterpretationV1,
} from '../common/editor/video-color-management-v27.ts';
import {
	createDefaultFramescaperAudioFinishingV27,
	normalizeFramescaperAudioFinishingV27,
} from './editor-audio-finishing-v27.ts';

/** Reconcile references affected by inherited source/clip/track/sequence commands. */
export function reconcileInheritedFramescaperProjectStateV27(project: Record<string, unknown>): void {
	const sequences = records(project.sequences, 'sequences');
	const sequenceIds = new Set(sequences.map(stableId));
	const contexts = byKey(records(project.videoColorContexts, 'videoColorContexts'), 'sequenceId');
	project.videoColorContexts = sequences.map((sequence) => contexts.get(stableId(sequence)) ?? ({
		schemaVersion: 1,
		sequenceId: stableId(sequence),
		workingSpace: 'linear-rec709-d65',
		outputSpace: 'rec709',
		alphaMode: 'straight-authored-premultiplied-working',
		toneMapping: 'none',
	}));
	const sources = records(project.sources, 'sources');
	const sourceById = new Map(sources.map((source) => [stableId(source), source]));
	const interpretations = byKey(
		records(project.videoSourceColorInterpretations, 'videoSourceColorInterpretations'),
		'sourceId',
	);
	project.videoSourceColorInterpretations = sources.flatMap((source) => {
		if (source.kind !== 'video' && source.kind !== 'still') return [];
		const existing = interpretations.get(stableId(source));
		return [existing?.sourceKind === source.kind
			? existing
			: defaultVideoSourceColorInterpretationV1(source.kind, stableId(source))];
	});
	const stacks = records(project.videoProcessorStacks, 'videoProcessorStacks')
		.filter((stack) => sourceById.get(String(stack.sourceId))?.kind === 'video');
	project.videoProcessorStacks = stacks;
	const stackById = new Map(stacks.map((stack) => [stableId(stack), stack]));
	project.videoMotionAnalyses = records(project.videoMotionAnalyses, 'videoMotionAnalyses')
		.filter((analysis) => {
			const stack = stackById.get(String(analysis.processorStackId));
			return stack?.sourceId === analysis.sourceId && sourceById.get(String(analysis.sourceId))?.kind === 'video';
		});
	const clips = [
		...records(project.clips, 'clips'),
		...records(record(project.projectBin, 'projectBin').clips, 'projectBin.clips'),
	];
	const clipIds = new Set(clips.map(stableId));
	const adjustmentIds = new Set(records(project.videoAdjustmentLayers, 'videoAdjustmentLayers').map(stableId));
	const maskIds = new Set(records(project.videoMaskMattes, 'videoMaskMattes').map(stableId));
	project.videoVisualPresentations = records(project.videoVisualPresentations, 'videoVisualPresentations')
		.filter((presentation) => ownerExists(record(presentation.owner, 'presentation owner'), {
			sourceById, clipIds, adjustmentIds, maskIds,
		}))
		.map((presentation) => ({
			...presentation,
			processorStackId: presentation.processorStackId !== null
				&& stackById.has(String(presentation.processorStackId)) ? presentation.processorStackId : null,
			maskMatteIds: ids(presentation.maskMatteIds).filter((id) => maskIds.has(id)),
		}));
	project.videoCaptionTracks = records(project.videoCaptionTracks, 'videoCaptionTracks')
		.filter((track) => sequenceIds.has(String(track.sequenceId)));
	reconcileAudio(project);
}

function reconcileAudio(project: Record<string, unknown>): void {
	try {
		const audio = normalizeFramescaperAudioFinishingV27(project, {
			automationLanes: project.automationLanes,
			mixer: project.mixer,
		});
		project.automationLanes = audio.automationLanes;
		project.mixer = audio.mixer;
	} catch {
		const defaults = createDefaultFramescaperAudioFinishingV27(project);
		project.automationLanes = defaults.automationLanes;
		project.mixer = defaults.mixer;
	}
}

function ownerExists(
	owner: Record<string, unknown>,
	refs: Readonly<{
		sourceById: ReadonlyMap<string, Record<string, unknown>>;
		clipIds: ReadonlySet<string>;
		adjustmentIds: ReadonlySet<string>;
		maskIds: ReadonlySet<string>;
	}>,
): boolean {
	const id = String(owner.id);
	if (owner.kind === 'source') return refs.sourceById.has(id);
	if (owner.kind === 'generator') return refs.sourceById.get(id)?.kind === 'generator';
	if (owner.kind === 'clip') return refs.clipIds.has(id);
	if (owner.kind === 'adjustment-layer') return refs.adjustmentIds.has(id);
	return owner.kind === 'mask-matte' && refs.maskIds.has(id);
}

function byKey(items: Record<string, unknown>[], key: string): Map<string, Record<string, unknown>> {
	return new Map(items.map((item) => [String(item[key]), item]));
}

function stableId(value: Record<string, unknown>): string {
	if (typeof value.id !== 'string' || !value.id) throw new TypeError('V27 inherited identity must be non-empty.');
	return value.id;
}

function ids(value: unknown): string[] {
	if (!Array.isArray(value)) throw new TypeError('V27 inherited IDs must be an array.');
	return value.map(String);
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Record<string, unknown>;
}

function records(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => record(item, `${name}[${String(index)}]`));
}

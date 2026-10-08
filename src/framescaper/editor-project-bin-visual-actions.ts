/* SPDX-License-Identifier: AGPL-3.0-only */

import { createStableId } from '../common/editor/stable-id.js';
import { sampleFrameToVideoFrame } from '../common/editor/timeline-time.ts';
import { resolveSequenceTimingView } from '../common/editor/sequence-timing-model.ts';
import {
	bindProductProjectBinActions, type ProductProjectBinActions,
} from '../common/editor/controller/composition/project-bin-action-group.ts';
import { createFramescaperImageBatchPlacementTimelineImage } from './editor-image-placement-timeline-image.ts';
import { createSplitVisualPresentationPlanner } from './editor-split-visual-presentations.ts';

type Data = Readonly<Record<string, unknown>>;

export interface FramescaperProjectBinVisualOwner {
	readonly project: unknown;
	getSnapshot(): Readonly<{ readonly selectedClipId?: unknown; readonly readOnly?: boolean; readonly importing?: boolean }>;
	getTelemetrySnapshot(): Readonly<{ readonly positionFrame?: unknown }>;
	selectClips(ids: readonly string[]): void;
	readonly actions: Readonly<{
		readonly projectBin: object;
		readonly edit: Readonly<{ commit(command: unknown): unknown }>;
	}>;
}

/** Keep image and generator bin transfers in their existing owned commands. */
export function bindFramescaperProjectBinVisualActions(owner: FramescaperProjectBinVisualOwner): void {
	bindProductProjectBinActions(owner.actions.projectBin, createFramescaperProjectBinVisualActions(owner));
}

export function createFramescaperProjectBinVisualActions(
	owner: FramescaperProjectBinVisualOwner,
	createId: (prefix: string) => string = createStableId,
): ProductProjectBinActions {
	return Object.freeze({ moveFromTimeline, place, rename, removeFromBin, removeFromProject, selectInstances, instanceCount });

	function binClip(id: string): Data | undefined {
		return records(data(data(owner.project).projectBin).clips).find(clip => clip.id === id && owned(clip));
	}

	function instanceCount(id: string): number | undefined {
		const clip = binClip(id);
		return clip ? records(data(owner.project).clips).filter(item => item.sourceId === clip.sourceId).length : undefined;
	}

	function selectInstances(id: string): readonly string[] | null | undefined {
		const clip = binClip(id);
		if (!clip) return undefined;
		if (blocked()) return null;
		const project = data(owner.project);
		const ids = records(project.clips).filter(item => item.sourceId === clip.sourceId).map(item => String(item.id));
		owner.selectClips(ids);
		return Object.freeze(ids);
	}

	function rename(id: string, value: unknown): string | null | undefined {
		const clip = binClip(id);
		if (!clip) return undefined;
		if (blocked()) return null;
		const name = String(value).trim();
		if (!name) throw new RangeError('A visual source name is required.');
		const source = records(data(owner.project).sources).find(item => item.id === clip.sourceId);
		if (!source) throw new ReferenceError('The visual source is missing.');
		owner.actions.edit.commit(sourceCommand(source, { ...source, name }));
		return name;
	}

	function removeFromBin(id: string): string | null | undefined {
		const clip = binClip(id);
		if (!clip) return undefined;
		if (blocked()) return null;
		owner.actions.edit.commit(clipCommand(clip, null, { scope: 'project-bin' }, null));
		return id;
	}

	function removeFromProject(id: string): readonly string[] | null | undefined {
		const clip = binClip(id);
		if (!clip) return undefined;
		if (blocked()) return null;
		const project = data(owner.project);
		const timeline = records(project.clips).filter(item => item.sourceId === clip.sourceId && owned(item));
		const bin = records(data(project.projectBin).clips).filter(item => item.sourceId === clip.sourceId && owned(item));
		const ids = new Set([...timeline, ...bin].map(item => String(item.id)));
		const selection = data(project.selection);
		const commands: Data[] = [{ type: 'selection/set', ...selection,
			clipIds: (Array.isArray(selection.clipIds) ? selection.clipIds : []).filter(item => !ids.has(String(item))) }];
		for (const item of timeline) {
			const track = records(project.tracks).find(candidate => Array.isArray(candidate.clipIds) && candidate.clipIds.includes(item.id));
			if (!track) throw new ReferenceError('The visual clip has no timeline owner.');
			commands.push(clipCommand(item, null, { scope: 'timeline', trackId: track.id }, null));
		}
		for (const item of bin) commands.push(clipCommand(item, null, { scope: 'project-bin' }, null));
		const source = records(project.sources).find(item => item.id === clip.sourceId);
		if (!source) throw new ReferenceError('The visual source is missing.');
		commands.push(sourceCommand(source, null));
		owner.actions.edit.commit({ type: 'batch', commands });
		return Object.freeze([...ids]);
	}

	function moveFromTimeline(request?: string | readonly (string | null | undefined)[] | null): readonly string[] | null | undefined {
		const project = data(owner.project);
		const clips = records(project.clips);
		const activeIds = Array.isArray(request) ? request : [request ?? owner.getSnapshot().selectedClipId];
		const selection = data(project.selection);
		const selected = Array.isArray(selection.clipIds) ? selection.clipIds : [];
		const ids = new Set(activeIds.filter((id): id is string => typeof id === 'string'));
		if (selected.some(id => ids.has(String(id)))) for (const id of selected) ids.add(String(id));
		if (!clips.some(clip => ids.has(String(clip.id)) && owned(clip))) return undefined;
		if (blocked()) return null;
		const moved = clips.filter(clip => ids.has(String(clip.id)));
		const commands: Data[] = [{ type: 'selection/set', ...selection,
			clipIds: selected.filter(id => !ids.has(String(id))) }];
		const inherited = moved.filter(clip => !owned(clip)).map(clip => String(clip.id));
		if (inherited.length) commands.push({ type: 'project-bin/move-from-timeline', clipIds: inherited });
		for (const clip of moved.filter(owned)) {
			const track = records(project.tracks).find(track => Array.isArray(track.clipIds) && track.clipIds.includes(clip.id));
			if (!track) throw new ReferenceError('The visual clip has no timeline owner.');
			commands.push(clipCommand(clip, clip, { scope: 'timeline', trackId: track.id }, { scope: 'project-bin' }));
		}
		owner.actions.edit.commit({ type: 'batch', commands });
		return Object.freeze(moved.map(clip => String(clip.id)));
	}

	function place(clipId: string, placement: Readonly<{ trackId?: string | null; timelineStartFrame?: unknown }> = {}): string | null | undefined {
		const project = data(owner.project);
		const clip = records(data(project.projectBin).clips).find(clip => clip.id === clipId);
		if (!clip || !owned(clip)) return undefined;
		if (blocked()) return null;
		const sequence = resolveSequenceTimingView(project);
		const sample = Number(placement.timelineStartFrame ?? owner.getTelemetrySnapshot().positionFrame);
		if (!Number.isSafeInteger(sample) || sample < 0) throw new RangeError('Bin placement needs a non-negative exact playhead sample.');
		const start = sampleFrameToVideoFrame(sample, sequence.rate, Number(project.sampleRate), 'point');
		const targetProject = placement.trackId ? { ...project,
			selection: { ...data(project.selection), trackIds: [placement.trackId] } } : project;
		const target = createFramescaperImageBatchPlacementTimelineImage(targetProject, {
			sequenceStartFrame: start, sequenceFrameCounts: [Number(clip.sequenceFrameCount)], createId,
		});
		const id = createId('clip');
		const candidate = { ...clip, id, sequenceId: target.sequenceId, sequenceStartFrame: start };
		const commands: Data[] = target.trackCommand ? [target.trackCommand] : [];
		commands.push(clipCommand(null, candidate, null, { scope: 'timeline', trackId: target.trackId }));
		const presentations = createSplitVisualPresentationPlanner(records(project.videoVisualPresentations)).copy(String(clip.id), id);
		commands.push(...presentations.map(command => ({ ...command })));
		owner.actions.edit.commit({ type: 'batch', commands });
		return id;
	}

	function blocked(): boolean {
		const snapshot = owner.getSnapshot();
		return snapshot.readOnly === true || snapshot.importing === true;
	}
}

function clipCommand(expected: Data | null, clip: Data | null, expectedPlacement: Data | null, placement: Data | null): Data {
	const identity = clip ?? expected!;
	return { type: identity.kind === 'image' ? 'image-clip/set' : 'video-visual-clip/set',
		clipId: identity.id, expectedClip: expected, expectedPlacement, clip, placement };
}

function sourceCommand(expected: Data, source: Data | null): Data {
	return { type: expected.kind === 'image' ? 'image-source/set' : 'video-visual-source/set',
		sourceId: expected.id, expectedSource: expected, source };
}

function owned(clip: Data): boolean { return clip.kind === 'image' || clip.kind === 'still' || clip.kind === 'generator'; }
function data(value: unknown): Data {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('A visual bin record is required.');
	return value as Data;
}
function records(value: unknown): readonly Data[] {
	if (!Array.isArray(value)) throw new TypeError('A visual bin collection is required.');
	return value.map((entry: unknown) => data(entry));
}

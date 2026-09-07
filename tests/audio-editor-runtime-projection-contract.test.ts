/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { projectForCommand } from '../src/common/editor/command-project-view.ts';
import { projectForCommandConsumers, projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { resolveRuntimeClipProjection, resolveRuntimeProjectProjection, type RuntimeClipProject, type RuntimePersistedClip } from '../src/common/editor/runtime-clip-projection.ts';

void test('runtime projection retains named document fields while replacing persisted coordinates', () => {
	const project: RuntimeClipProject & Readonly<{ id: string; title: string }> = {
		id: 'projection-contract', title: 'Owned identity', schemaVersion: 2, sampleRate: 48_000,
		clips: [{ id: 'clip', sourceId: 'source', timelineStartFrame: 8, durationFrames: 16,
			sourceStartFrame: 4, sourceDurationFrames: 16 }], tracks: [],
	};
	const projected = projectForRuntimeConsumers(project);
	const id: string = projected.id;
	const title: string = projected.title;
	const duration: number = projected.clips[0].durationFrames;
	assert.equal(id, project.id);
	assert.equal(title, project.title);
	assert.equal(duration, 16);
	assert.equal(projected.clips[0].coordinateDomain, 'resolved-samples');
	assert.equal(projectForRuntimeConsumers(projected), projected);
	assert.notEqual(projected, project);
	assert.equal(project.clips?.[0].coordinateDomain, undefined);
});

void test('clip projection retains owner identity without intersecting forbidden persisted timing fields', () => {
	interface AuthoredClip extends RuntimePersistedClip {
		readonly id: string;
		readonly sourceId: string;
		readonly kind: 'audio';
		readonly timelineStartFrame?: never;
		readonly durationFrames?: never;
	}
	const clip: AuthoredClip = { id: 'authored', sourceId: 'audio', kind: 'audio',
		anchor: 'musical', musicalStartBeat: 2, musicalExtent: 'beat', musicalDurationBeats: 2,
		sourceStartFrame: 0, sourceDurationFrames: 48_000,
	};
	const project = { schemaVersion: 17, sampleRate: 48_000, clips: [clip], tracks: [],
		tempoMap: { mode: 'musical' as const, events: [
			{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } },
		] },
	};
	const projected = resolveRuntimeClipProjection(project, clip);
	const id: string = projected.id;
	const sourceId: string = projected.sourceId;
	const kind: 'audio' = projected.kind;
	const duration: number = projected.durationFrames;
	assert.deepEqual([id, sourceId, kind, duration], ['authored', 'audio', 'audio', 48_000]);
	const entry = resolveRuntimeProjectProjection(project).clips[0];
	assert.ok(entry);
	const projectClipId: string = entry.id;
	assert.equal(projectClipId, id);
	assert.equal(entry.timelineStartFrame, 48_000);
});

void test('project projection retains track and bin ownership while resolving musical labels', () => {
	const label = { id: 'cue', title: 'Verse', anchor: 'musical' as const,
		startBeat: { num: 2, den: 1 }, endBeat: { num: 4, den: 1 },
	};
	const clip = { id: 'bin-clip', kind: 'audio' as const, sourceId: 'audio',
		timelineStartFrame: 0, durationFrames: 100, sourceStartFrame: 0, sourceDurationFrames: 100,
	};
	const track = { id: 'labels', type: 'label' as const, name: 'Cues', labels: [label] };
	const project = { schemaVersion: 17, sampleRate: 48_000, clips: [], tracks: [track],
		projectBin: { clips: [clip], selectedClipId: clip.id },
		tempoMap: { mode: 'musical' as const, events: [
			{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } },
		] },
	};
	const projected = resolveRuntimeProjectProjection(project);
	const name: string = projected.tracks[0].name;
	const labelTitle: string = projected.tracks[0].labels[0].title;
	const startFrame: number = projected.tracks[0].labels[0].startFrame;
	const sourceId: string = projected.projectBin.clips[0].sourceId;
	const selectedClipId: string = projected.projectBin.selectedClipId;
	assert.deepEqual([name, labelTitle, startFrame, sourceId, selectedClipId], ['Cues', 'Verse', 48_000, 'audio', 'bin-clip']);
	assert.equal(Object.hasOwn(label, 'startFrame'), false);
	assert.equal(Object.hasOwn(clip, 'coordinateDomain'), false);
});

void test('command projection preserves source identity and supplies only the video sample alias', () => {
	const video = { id: 'video', kind: 'video' as const, sampleFrameCount: 96_000 };
	const image = { id: 'image', kind: 'image' as const, width: 1920 };
	const project = { id: 'command-view', schemaVersion: 17, sampleRate: 48_000,
		sources: [video, image], clips: [], tracks: [], projectBin: { clips: [] },
	};
	const view = projectForCommand(project);
	const id: string = view.id;
	assert.equal(id, project.id);
	for (const source of view.sources) {
		const sourceId: string = source.id;
		if (source.kind === 'video') {
			const frameCount: number = source.frameCount;
			assert.equal(frameCount, 96_000);
			assert.equal(sourceId, 'video');
		} else {
			const width: number = source.width;
			assert.equal(width, 1920);
			assert.equal(Object.hasOwn(source, 'frameCount'), false);
		}
	}
	assert.equal(Object.hasOwn(video, 'frameCount'), false);
});

void test('command consumer facade retains owner fields and nullable passthrough', () => {
	const project = { id: 'facade', title: 'Owner title', schemaVersion: 17, sampleRate: 48_000,
		sources: [], clips: [], tracks: [], projectBin: { clips: [] },
	};
	const view = projectForCommandConsumers(project);
	const id: string = view.id;
	const title: string = view.title;
	assert.deepEqual([id, title], ['facade', 'Owner title']);
	assert.equal(projectForCommandConsumers(null), null);
	assert.equal(projectForCommandConsumers(undefined), undefined);
	const legacy = { id: 'legacy', schemaVersion: 2 };
	assert.equal(projectForCommandConsumers(legacy), legacy);
});

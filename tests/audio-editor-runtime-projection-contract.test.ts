/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
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

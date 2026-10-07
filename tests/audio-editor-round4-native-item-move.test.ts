/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAudacityItemNavigationAction } from '../src/common/editor/audacity-shortcut-actions/item-navigation.ts';
import { itemNavigationClipGeometry } from '../src/common/editor/audacity-shortcut-actions/item-navigation-geometry.ts';
import { createClipTransformService } from '../src/common/editor/controller/clip-video/internal/clip/clip-transform-service.ts';
import type { ClipTransformProject } from '../src/common/editor/controller/clip-video/internal/clip/clip-domain-types.ts';
import type { ControllerClip, ControllerProject } from '../src/common/editor/controller/track-audio/track-domain-types.ts';
import { createEditorProjectRuntimeSelection } from '../src/framescaper/editor-project-runtime-selection.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperBaselineImageFixture } from './helpers/framescaper-baseline-image-fixture.ts';

test('global item keyboard movement reaches the existing canonical image move service and keeps animation phase', () => {
	const { project, clip } = createFramescaperBaselineImageFixture({ imageOnly: true });
	const runtime = createEditorProjectRuntimeSelection(FRAMESCAPER_PROJECT_RUNTIME_PROFILE);
	let history = runtime.createHistory(project);
	let nextId = 0;
	const service = createClipTransformService({
		lifetime: { assertActive() {} }, copy: { audioClipNotFound: 'Missing clip',
			track: 'Track', timelineFramesFinite: 'Finite frames required' },
		getProject: () => runtime.projectForCommandConsumers(history.present) as unknown as ClipTransformProject,
		getSelectedClipId: () => clip.id, editingBlocked: () => false,
		createId: prefix => `${prefix}-derived-${String(++nextId)}`, snapTimelineFrame: frame => Math.round(Number(frame)),
		activeSelection: () => null, commit: command => { history = runtime.executeCommand(history, command); },
	});
	const controller = {
		getSnapshot: () => ({ project: history.present as unknown as ControllerProject,
			selectedClipId: clip.id, timeline: { pixelsPerSecond: 100 } }),
		actions: {
			clip: { move: (id: string, trackId: string, frame: number) => service.moveClips(id, trackId, frame), trim: () => null },
			edit: { commit: () => null }, labels: { update: () => null }, timeline: { setSelection: () => null },
			track: { moveUp: () => null, moveDown: () => null }, transport: { seek: () => null },
		},
	};
	applyAudacityItemNavigationAction('track-view-item-move-right', controller);
	assert.deepEqual(history.present.clips.find(candidate => candidate.id === clip.id), { ...clip, sequenceStartFrame: 1 });
	applyAudacityItemNavigationAction('track-view-item-move-left', controller);
	assert.deepEqual(history.present.clips.find(candidate => candidate.id === clip.id), clip);
	history = runtime.undo(history);
	assert.equal(history.present.clips.find(candidate => candidate.id === clip.id)?.sequenceStartFrame, 1);
	history = runtime.undo(history);
	assert.deepEqual(history.present.clips, project.clips);
	history = runtime.redo(history);
	assert.equal(history.present.clips.find(candidate => candidate.id === clip.id)?.sequenceStartFrame, 1);
});

test('native item geometry converts absolute NTSC boundaries without mutating the authored clip', () => {
	const clip = { id: 'poster', kind: 'image', sourceId: 'image', sequenceId: 'main', sequenceStartFrame: 1,
		sequenceFrameCount: 1, sourceStartTicks: '250000' } as unknown as ControllerClip;
	const project = { sampleRate: 44_100, sequences: [{ id: 'main', rate: { num: 24, den: 1 } }] } as unknown as ControllerProject;
	const before = structuredClone(clip);
	const geometry = itemNavigationClipGeometry(project, clip);
	assert.equal(geometry.timelineStartFrame, 1_838);
	assert.equal(geometry.durationFrames, 1_837);
	assert.equal(geometry.sourceStartTicks, '250000');
	assert.deepEqual(clip, before);
});

test('opposite item moves restore a native clip when ten pixels is half a sequence frame', () => {
	let clip = { id: 'poster', kind: 'image', sequenceId: 'main', sequenceStartFrame: 0,
		sequenceFrameCount: 150 } as unknown as ControllerClip;
	const project = { sampleRate: 48_000, tracks: [{ id: 'picture', type: 'video', clipIds: ['poster'] }],
		sequences: [{ id: 'main', rate: { num: 30, den: 1 } }], clips: [clip] } as unknown as ControllerProject;
	const controller = {
		getSnapshot: () => ({ project: { ...project, clips: [clip] }, selectedClipId: clip.id,
			timeline: { pixelsPerSecond: 120 } }),
		actions: { clip: { move: (_id: string, _track: string, frame: number) => {
			clip = { ...clip, sequenceStartFrame: Math.round(frame / 1_600) };
		}, trim: () => null }, edit: { commit: () => null }, labels: { update: () => null },
			timeline: { setSelection: () => null }, track: { moveUp: () => null, moveDown: () => null },
			transport: { seek: () => null } },
	};
	applyAudacityItemNavigationAction('track-view-item-move-right', controller);
	assert.ok(Number(clip.sequenceStartFrame) > 0);
	applyAudacityItemNavigationAction('track-view-item-move-left', controller);
	assert.equal(clip.sequenceStartFrame, 0);
});

test('musical item geometry measures the current tempo while legacy sample geometry remains authoritative', () => {
	const project = { schemaVersion: 20, sampleRate: 48_000,
		tempoMap: { mode: 'musical', events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }] },
	} as unknown as ControllerProject;
	const clip = { id: 'recording', kind: 'audio', sourceId: 'source', anchor: 'musical',
		musicalStartBeat: { num: 3, den: 1 }, musicalExtent: 'beat', musicalDurationBeats: { num: 2, den: 1 },
		sourceStartFrame: 0, sourceDurationFrames: 48_000 } as unknown as ControllerClip;
	const geometry = itemNavigationClipGeometry(project, clip);
	assert.equal(geometry.timelineStartFrame, 72_000);
	assert.equal(geometry.durationFrames, 48_000);
	const legacy = { ...geometry, anchor: 'absolute', timelineStartFrame: 125 };
	assert.equal(itemNavigationClipGeometry(project, legacy), legacy);
});

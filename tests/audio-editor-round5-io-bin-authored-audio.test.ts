/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioClip, createAudioSource, createVideoClip, createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { createProjectBinPreviewService, type ProjectBinPreviewEngine } from '../src/common/editor/controller/import/internal/project-bin/project-bin-preview-service.ts';
import type { EngineProject } from '../src/common/editor/engine/types.ts';
import type { ProjectBinPreview, ProjectBinProject } from '../src/common/editor/controller/import/project-bin-types.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';

function cameraFixture(withAudio = true) {
	const camera = createVideoSource({ id: 'camera', storageKey: 'camera', sampleRate: 48_000,
		sampleFrameCount: 96_000, frameRate: { num: 25, den: 1 }, sourceFrameCount: 50,
		width: 96, height: 54, hasAudio: true });
	const video = createVideoClip({ id: 'picture', sourceId: camera.id, title: 'Camera',
		sequenceId: 'main', sequenceStartFrame: 0, sequenceFrameCount: 50,
		sourceInFrame: 0, sourceFrameCount: 50, binItemId: 'camera-item' }, {
		source: camera, projectSampleRate: 48_000, sequence: { id: 'main', rate: { num: 25, den: 1 } },
	});
	const source = createAudioSource({ id: 'authored-silence', storageKey: 'authored-silence',
		sampleRate: 48_000, frameCount: 96_000, channelCount: 1 });
	const audio = createAudioClip({ id: 'sound', sourceId: source.id, title: 'Silence audio',
		timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 96_000,
		durationFrames: 96_000, binItemId: 'camera-item' });
	const project: ProjectBinProject = { id: 'project', schemaVersion: 17, revision: 0,
		sampleRate: 48_000, tracks: [], clips: [], sources: [camera, source],
		projectBin: { clips: [{ ...video, binItemId: 'camera-item' }, ...(withAudio ? [{ ...audio, binItemId: 'camera-item' }] : [])] },
	};
	return project;
}

function harness(project = cameraFixture(), play: () => Promise<void> = async () => undefined) {
	const lifetime = new EditorControllerLifetime();
	const generations = new EditorProjectGeneration();
	generations.activate(project.id);
	let preview: ProjectBinPreview | null = null;
	let loaded: EngineProject | null = null;
	let plays = 0, pauses = 0, stops = 0, disposed = 0, creations = 0;
	let stateChanged: (state: string) => void = () => undefined;
	const missing = new Set<string>();
	const engine: ProjectBinPreviewEngine = {
		loadProject: (value) => { loaded = value; },
		play: async () => { plays++; await play(); },
		pause: () => { pauses++; }, stop: () => { stops++; },
		dispose: () => { disposed++; },
	};
	const service = createProjectBinPreviewService({ lifetime,
		copy: { audioClipNotFound: 'Clip missing', localSourcesMissing: 'Source missing' },
		retireTimelinePlayback: () => undefined,
		sourceBuffers: new Map(), sourceChunkProviders: new Map(),
		createPreviewEngine: ({ onState }) => { creations++; stateChanged = onState; return engine; },
		createId: (prefix) => `${prefix}-owned`,
		captureProject: () => generations.capture(project.id),
		assertProject: (token) => generations.assertCurrent(token),
		getProject: () => project, getPreview: () => preview,
		setPreview: (value) => { preview = value; },
		isSourceMissing: (id) => missing.has(id),
		getVisualData: () => ({ mediaUrl: 'blob:camera' }), publish: () => undefined,
	});
	return { service, missing, generations,
		get preview() { return preview; }, get loaded() { return loaded; },
		get counts() { return { plays, pauses, stops, disposed, creations }; },
		emit: (state: string) => stateChanged(state),
	};
}

test('camera audition renders the current companion source while retaining native picture transport', async () => {
	const original = cameraFixture();
	const before = structuredClone(original);
	const fixture = harness(original);
	const preview = await fixture.service.playPauseProjectBinClip('picture');
	assert.equal(fixture.counts.plays, 1);
	assert.equal(preview.kind, 'video');
	assert.equal(preview.mediaUrl, 'blob:camera');
	assert.ok(fixture.loaded);
	assert.deepEqual(fixture.loaded.sources?.map(source => source.id), ['authored-silence']);
	assert.equal(fixture.loaded.clips?.[0]?.sourceId, 'authored-silence');
	assert.equal(fixture.loaded.clips?.[0]?.durationFrames, 96_000);
	assert.deepEqual(original, before, 'audition must not mutate the authored source or template');
});

test('camera picture and companion share pause, resume, stop and disposal', async () => {
	const fixture = harness();
	await fixture.service.playPauseProjectBinClip('picture');
	assert.equal((await fixture.service.playPauseProjectBinClip('picture')).state, 'paused');
	assert.equal(fixture.counts.pauses, 1);
	assert.equal((await fixture.service.playPauseProjectBinClip('picture')).state, 'playing');
	assert.equal(fixture.counts.plays, 2);
	await fixture.service.stopProjectBinPreview({ dispose: true });
	assert.equal(fixture.preview, null);
	assert.equal(fixture.counts.stops, 1);
	assert.equal(fixture.counts.disposed, 1);
});

test('camera companion completion retires the active picture transport', async () => {
	const fixture = harness();
	await fixture.service.playPauseProjectBinClip('picture');
	fixture.emit('stopped');
	assert.equal(fixture.preview?.state, 'stopped');
});

test('a missing current camera companion is refused instead of playing the embedded original', async () => {
	const fixture = harness();
	fixture.missing.add('authored-silence');
	await assert.rejects(fixture.service.playPauseProjectBinClip('picture'), /Source missing/u);
	assert.equal(fixture.preview, null);
});

test('late companion preparation cannot start a camera in a switched project', async () => {
	let complete: () => void = () => undefined;
	const prepared = new Promise<void>(resolve => { complete = resolve; });
	const fixture = harness(cameraFixture(), async () => prepared);
	const pending = fixture.service.playPauseProjectBinClip('picture');
	await Promise.resolve(); await Promise.resolve();
	fixture.generations.activate('other-project');
	complete();
	await assert.rejects(pending, /changed/u);
});

test('a camera without a companion retains its native silent picture transport', async () => {
	const fixture = harness(cameraFixture(false));
	assert.deepEqual(await fixture.service.playPauseProjectBinClip('picture'), {
		clipId: 'picture', binItemId: 'camera-item', state: 'playing', kind: 'video', mediaUrl: 'blob:camera',
	});
	assert.equal(fixture.counts.creations, 0);
	assert.equal((await fixture.service.playPauseProjectBinClip('picture')).state, 'paused');
	assert.equal((await fixture.service.playPauseProjectBinClip('picture')).state, 'playing');
});

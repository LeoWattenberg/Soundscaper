/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEditorExportService } from '../src/common/editor/controller/export/internal/export-service.ts';
import { createFixture, defaultPlan, type TestProject } from './helpers/export-service-fixture.ts';

function clipFixture(realtime = false) {
	const fixture = createFixture();
	const project = {
		id: 'clips-project', title: 'Takes', sampleRate: 48_000, masterChannels: 2,
		tracks: [
			{ id: 'one', type: 'audio', clipIds: ['a', 'overlap'] },
			{ id: 'two', type: 'audio', clipIds: ['b'] },
		],
		clips: [
			{ id: 'a', kind: 'audio', sourceId: 'audio-source', trackId: 'one', timelineStartFrame: 2, durationFrames: realtime ? 6 : 3 },
			{ id: 'overlap', kind: 'audio', sourceId: 'audio-source', trackId: 'one', timelineStartFrame: 2, durationFrames: 6 },
			{ id: 'b', kind: 'audio', sourceId: 'audio-source', trackId: 'two', timelineStartFrame: 6, durationFrames: 6 },
		].map((clip) => ({ ...clip, sourceStartFrame: 0, sourceDurationFrames: clip.durationFrames })),
		sources: [{ id: 'audio-source' }],
	};
	fixture.setProject(project);
	const plan = defaultPlan();
	plan.mode = 'clips';
	plan.tailFrames = 0;
	if (realtime) plan.render = { strategy: 'realtime-stream' };
	plan.outputs = [
		{ fileName: '01-Take.wav', trackId: 'one', clipId: 'a', frames: [2, realtime ? 8 : 5] },
		{ fileName: '02-Take.wav', trackId: 'two', clipId: 'b', frames: [6, 12] },
	].map(({ fileName, trackId, clipId, frames }) => ({
		kind: 'clip', fileName, trackId, clipId, includeMaster: false, respectMuteSolo: false,
		range: { startFrame: frames[0]!, endFrame: frames[1]!, durationFrames: frames[1]! - frames[0]! },
		outputFrames: frames[1]! - frames[0]!, outputFileBytes: null,
	}));
	plan.archive = {
		format: 'zip', fileName: 'Takes-clips.zip', mimeType: 'application/zip',
		expectedByteLength: null,
		entries: plan.outputs.map(({ fileName }) => ({ fileName, expectedByteLength: null })),
	};
	fixture.setPlan(plan);
	return fixture;
}

test('clip archive renders only its named clip over its own span and conforms each file', async () => {
	const fixture = clipFixture();
	const rendered: Array<{ clipIds: string[]; range: Record<string, unknown> }> = [];
	fixture.renderOptions.renderSnapshot = async (...args: unknown[]) => {
		const snapshot = args[0] as TestProject;
		const range = args[1] as Record<string, unknown>;
		rendered.push({ clipIds: snapshot.clips.map(({ id }) => id), range });
		const length = Number(range.outputFrames);
		return {
			sampleRate: 48_000, length, numberOfChannels: 2,
			channels: [new Float32Array(length), new Float32Array(length)],
		};
	};
	const result = await createEditorExportService(fixture.runtime).handleExportAction('export', {
		mode: 'clips', includeTail: true,
	});
	assert.equal(result.fileName, 'Takes-clips.zip');
	assert.deepEqual(rendered.map(({ clipIds }) => clipIds), [['a'], ['b']]);
	// Render the isolated projection without a track filter so detector bus feeds remain available.
	assert.deepEqual(rendered.map(({ range }) => ({
		startFrame: range.startFrame, endFrame: range.endFrame, includeTail: range.includeTail,
		trackId: range.trackId, includeMaster: range.includeMaster, respectMuteSolo: range.respectMuteSolo,
	})), [
		{ startFrame: 2, endFrame: 5, includeTail: 0, trackId: null, includeMaster: false, respectMuteSolo: false },
		{ startFrame: 6, endFrame: 12, includeTail: 0, trackId: null, includeMaster: false, respectMuteSolo: false },
	]);
	assert.deepEqual(fixture.encodedFrameCounts, [3, 6]);
	assert.deepEqual(fixture.progress, [0.5, 1]);
	assert.deepEqual(fixture.calls.filter((call) => call.startsWith('archive-add')), [
		'archive-add:01-Take.wav', 'archive-add:02-Take.wav',
	]);
	assert.deepEqual(fixture.errors, []);
});

test('a failed clip archive is aborted before any download is published', async () => {
	const fixture = clipFixture();
	fixture.setArchiveAddFails(true);
	await createEditorExportService(fixture.runtime).handleExportAction('export', { mode: 'clips' });
	assert.equal(fixture.calls.includes('archive-abort'), true);
	assert.deepEqual(fixture.downloads, []);
	assert.match((fixture.errors[0] as Error).message, /archive add failed/u);
});

test('realtime clip exports load isolated snapshots and retain per-clip render bounds', async () => {
	const fixture = clipFixture(true);
	const loaded: string[][] = [];
	const runtime = {
		...fixture.runtime,
		createCacheAwareRenderEngine: () => {
			const engine = fixture.runtime.createCacheAwareRenderEngine() as {
				loadProject(project: TestProject, sourceMap: unknown): void;
			};
			return {
				...engine,
				loadProject(project: TestProject, sourceMap: unknown) {
					loaded.push(project.clips.map(({ id }) => id));
					engine.loadProject(project, sourceMap);
				},
			};
		},
	};
	const result = await createEditorExportService(runtime).handleExportAction('export', { mode: 'clips' });
	assert.equal(result.fileName, 'Takes-clips.zip');
	assert.deepEqual(loaded, [['a'], ['b']]);
	assert.deepEqual(fixture.realtimeRenderOptions.map(({ startFrame, endFrame, trackId, includeMaster }) => ({
		startFrame, endFrame, trackId, includeMaster,
	})), [
		{ startFrame: 2, endFrame: 8, trackId: null, includeMaster: false },
		{ startFrame: 6, endFrame: 12, trackId: null, includeMaster: false },
	]);
	assert.deepEqual(fixture.errors, []);
});

test('clip splitting refuses frozen tracks before their whole-track render can replace the clips', async () => {
	const fixture = clipFixture();
	const project = fixture.runtime.getProject() as TestProject;
	fixture.setProject({ ...project, tracks: project.tracks.map((track) => ({ ...track, audioFreeze: {} })) });
	await createEditorExportService(fixture.runtime).handleExportAction('export', { mode: 'clips' });
	assert.match((fixture.errors[0] as Error).message, /Unfreeze.*individual clips/u);
	assert.deepEqual(fixture.downloads, []);
	assert.deepEqual(fixture.preflightBytes, []);
});

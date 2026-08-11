/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

import type {
	FrameCanonicalEdgeTrimPlan,
	FrameCanonicalEdgeTrimRequest,
} from '../src/common/editor/frame-canonical-edge-trim-domain.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { createPersistedVideoProject } from './helpers/persisted-video-project-fixture.ts';

const assetLoader = `
	export async function resolve(specifier, context, nextResolve) {
		if (specifier === '@ffmpeg/core?url' || specifier === '@ffmpeg/core/wasm?url') {
			return {
				url: 'data:text/javascript,export default "mock-ffmpeg-asset"',
				shortCircuit: true,
			};
		}
		return nextResolve(specifier, context);
	}
`;

register(`data:text/javascript,${encodeURIComponent(assetLoader)}`, import.meta.url);

const { createAudioEditorController } = await import('../src/common/editor/app.js');
const { createProjectStore } = await import('../src/common/editor/storage.js');

const REQUEST = Object.freeze({
	activeClipId: 'persisted-timeline-video',
	edge: 'right',
	requestedBoundarySample: 38_401,
}) satisfies FrameCanonicalEdgeTrimRequest;

test('composed Framescaper trim actions preview and commit one canonical V15 history operation', async () => {
	const fixture = createPersistedVideoProject({ timeline: true });
	const store = createProjectStore({
		indexedDB: null,
		databaseName: `framescaper-edge-trim-controller-${String(Date.now())}`,
		memoryFallback: true,
		preferOpfs: false,
	});
	await store.ready();
	await store.saveProject(fixture.project);
	await store.saveSetting('framescaper:last-project-id', fixture.project.id);
	const controller = createAudioEditorController(null, {
		headless: true,
		productId: 'framescaper',
		store,
		engine: createTestEngine(),
		ffmpeg: { dispose() {} },
	});

	try {
		await controller.ready;
		const trim = videoTrimActions(controller);
		const statusBeforePreview = structuredClone(controller.getSnapshot().status);
		const preview = trim.preview(REQUEST);
		assert.equal(preview.kind, 'transform');
		assert.equal(preview.requestedBoundarySample, 38_401);
		assert.equal(preview.boundarySample, 38_400);
		assert.deepEqual(preview.participantClipIds, [
			'persisted-timeline-video', 'persisted-timeline-audio',
		]);
		assert.deepEqual(controller.getSnapshot().history.undoEntries, []);
		assert.deepEqual(controller.getSnapshot().status, statusBeforePreview);

		const committed = trim.commit(REQUEST);
		assert.deepEqual(committed, preview);
		const snapshot = controller.getSnapshot();
		assert.deepEqual(snapshot.history.undoEntries, [{
			type: 'clip/transform-many',
			commandCount: 1,
			commands: ['clip/transform-many'],
		}]);
		assert.equal(snapshot.history.canUndo, true);
		assert.deepEqual(snapshot.status, {
			message: 'Trimmed right edge to 00:00:00:24.',
			state: 'success',
		});
		const persistedVideo = mediaClip(snapshot.project, 'persisted-timeline-video');
		assert.deepEqual([
			persistedVideo.sequenceStartFrame,
			persistedVideo.sequenceFrameCount,
			persistedVideo.sourceInFrame,
			persistedVideo.sourceFrameCount,
		], [0, 24, 0, 20]);
		for (const alias of [
			'timelineStartFrame', 'durationFrames', 'sourceStartFrame', 'sourceDurationFrames',
		]) assert.equal(Object.hasOwn(persistedVideo, alias), false, alias);
		assert.deepEqual(resolvedEndpoints(snapshot.project), [
			['persisted-timeline-video', 0, 38_400],
			['persisted-timeline-audio', 0, 38_400],
		]);

		controller.actions.edit.undo();
		const undone = controller.getSnapshot();
		assert.deepEqual(resolvedEndpoints(undone.project), [
			['persisted-timeline-video', 0, 48_000],
			['persisted-timeline-audio', 0, 48_000],
		]);
		assert.equal(undone.history.canUndo, false);
		assert.equal(undone.history.canRedo, true);
	} finally {
		await controller.dispose();
	}
});

test('the composed Soundscaper facade capability-gates both video trim actions', async () => {
	const controller = createAudioEditorController(null, {
		headless: true,
		productId: 'soundscaper',
		engine: createTestEngine(),
		ffmpeg: { dispose() {} },
	});
	try {
		await controller.ready;
		const trim = videoTrimActions(controller);
		assert.throws(() => trim.preview(REQUEST), /Soundscaper does not support videoCompositing/u);
		assert.throws(() => trim.commit(REQUEST), /Soundscaper does not support videoCompositing/u);
		assert.deepEqual(controller.getSnapshot().history.undoEntries, []);
	} finally {
		await controller.dispose();
	}
});

interface VideoTrimActions {
	preview(request: FrameCanonicalEdgeTrimRequest): FrameCanonicalEdgeTrimPlan;
	commit(request: FrameCanonicalEdgeTrimRequest): FrameCanonicalEdgeTrimPlan;
}

function videoTrimActions(controller: Readonly<Record<string, unknown>>): VideoTrimActions {
	const actions = record(controller.actions, 'controller.actions');
	const video = record(actions.video, 'controller.actions.video');
	const trim = record(video.trim, 'controller.actions.video.trim');
	if (typeof trim.preview !== 'function' || typeof trim.commit !== 'function') {
		throw new TypeError('The composed video trim actions are unavailable.');
	}
	return trim as unknown as VideoTrimActions;
}

function mediaClip(
	project: Readonly<Record<string, unknown>>,
	clipId: string,
): Readonly<Record<string, unknown>> {
	const clips = Array.isArray(project.clips) ? project.clips : [];
	const clip = clips.find((candidate) => record(candidate, 'clip').id === clipId);
	if (!clip) throw new ReferenceError(`Missing clip ${clipId}.`);
	return record(clip, `clip ${clipId}`);
}

function resolvedEndpoints(project: Readonly<Record<string, unknown>>) {
	return resolveRuntimeProjectProjection(project).clips.map((clip) => [
		clip.id, clip.timelineStartFrame, clip.timelineEndFrame,
	]);
}

function record(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as Readonly<Record<string, unknown>>;
}

function createTestEngine() {
	let positionFrame = 0;
	return {
		loadProject() {},
		async applyProject() {},
		getPositionFrames: () => positionFrame,
		getState: () => ({ state: 'stopped', loop: { enabled: false } }),
		stop() {},
		play() {},
		pause() {},
		seek(frame: number) { positionFrame = frame; return positionFrame; },
		setLoop() {},
		setSourceResolver() { return this; },
		async dispose() {},
	};
}

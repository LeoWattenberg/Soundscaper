/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

import type {
	FrameCanonicalRollRippleTrimPlan,
	FrameCanonicalRollRippleTrimRequest,
} from '../src/common/editor/frame-canonical-roll-ripple-trim-domain.ts';
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
	mode: 'ripple',
	activeClipId: 'persisted-timeline-video',
	edge: 'right',
	requestedBoundarySample: 38_401,
}) satisfies FrameCanonicalRollRippleTrimRequest;

test('composed Framescaper actions preserve ordinary trim and commit roll/ripple through one history entry', async () => {
	const fixture = createPersistedVideoProject({ timeline: true });
	const store = createProjectStore({
		indexedDB: null,
		databaseName: `framescaper-roll-ripple-controller-${String(Date.now())}`,
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
		const trim = trimActions(controller);
		assert.equal(typeof trim.preview, 'function');
		assert.equal(typeof trim.commit, 'function');
		const preview = trim.rollRipple.preview(REQUEST);
		assert.equal(preview.kind, 'transform');
		assert.equal(preview.mode, 'ripple');
		assert.equal(preview.edge, 'right');
		assert.equal(preview.requestedBoundarySample, 38_401);
		assert.equal(preview.resolvedSourceCutSample, 38_400);
		assert.equal(preview.programEditSample, 38_400);
		assert.equal(preview.sequenceFrameDelta, -6);
		assert.deepEqual(controller.getSnapshot().history.undoEntries, []);

		const committed = trim.rollRipple.commit(REQUEST);
		assert.deepEqual(committed, preview);
		assert.deepEqual(controller.getSnapshot().history.undoEntries, [{
			type: 'clip/transform-many',
			commandCount: 1,
			commands: ['clip/transform-many'],
		}]);
		assert.deepEqual(controller.getSnapshot().status, {
			message: 'Rippled right edge by -6 frames; source cut 00:00:00:24; program edit 00:00:00:24.',
			state: 'success',
		});
	} finally {
		await controller.dispose();
	}
});

test('the real Soundscaper facade capability-rejects roll/ripple while retaining no history', async () => {
	const controller = createAudioEditorController(null, {
		headless: true,
		productId: 'soundscaper',
		engine: createTestEngine(),
		ffmpeg: { dispose() {} },
	});
	try {
		await controller.ready;
		const rollRipple = trimActions(controller).rollRipple;
		assert.throws(
			() => rollRipple.preview(REQUEST),
			/Soundscaper does not support videoCompositing/u,
		);
		assert.throws(
			() => rollRipple.commit(REQUEST),
			/Soundscaper does not support videoCompositing/u,
		);
		assert.deepEqual(controller.getSnapshot().history.undoEntries, []);
	} finally {
		await controller.dispose();
	}
});

interface RollRippleActions {
	preview(request: FrameCanonicalRollRippleTrimRequest): FrameCanonicalRollRippleTrimPlan;
	commit(request: FrameCanonicalRollRippleTrimRequest): FrameCanonicalRollRippleTrimPlan;
}

interface TrimActions {
	readonly preview: (...args: readonly unknown[]) => unknown;
	readonly commit: (...args: readonly unknown[]) => unknown;
	readonly rollRipple: RollRippleActions;
}

function trimActions(controller: Readonly<Record<string, unknown>>): TrimActions {
	const actions = record(controller.actions, 'controller.actions');
	const video = record(actions.video, 'controller.actions.video');
	const trim = record(video.trim, 'controller.actions.video.trim');
	if (typeof trim.preview !== 'function' || typeof trim.commit !== 'function') {
		throw new TypeError('Ordinary video trim actions are unavailable.');
	}
	const rollRipple = record(trim.rollRipple, 'controller.actions.video.trim.rollRipple');
	if (typeof rollRipple.preview !== 'function' || typeof rollRipple.commit !== 'function') {
		throw new TypeError('Roll/ripple trim actions are unavailable.');
	}
	return trim as unknown as TrimActions;
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

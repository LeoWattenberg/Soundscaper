/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoEffectService, type VideoEffectProject } from '../src/common/editor/controller/clip-video/video-effect-service.ts';
import { EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectFinishing, cloneFramescaperProjectFinishing } from '../src/framescaper/editor-project-finishing.ts';
import { applyFramescaperProjectCommandFinishing } from '../src/framescaper/editor-project-finishing-commands.ts';
import { applyVideoExactBrowserEffectsFinishing } from '../src/framescaper/editor-video-exact-browser-effects-finishing.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

const LIVE = new AbortController().signal;
function view(project: unknown): VideoEffectProject { return project as VideoEffectProject; }
function pixels(values: number[]) { return new Uint8Array(values.flatMap(value => value === 0 ? [0, 0, 0, 0] : [value, value + 10, value + 20, 255])); }
function author() {
	let project = createFramescaperProjectFinishing(PROFILE, framescaperV20Options());
	const initial = project, generation = new EditorProjectGeneration(); generation.activate(view(project).id);
	const service = createVideoEffectService({ state: { selectedClipId: 'video-clip', readOnly: false, videoEffectGestures: new Map() },
		copy: { projectReadOnly: 'Read only' }, getProject: () => view(project), captureProject: () => generation.capture(view(project).id),
		assertProject: token => { generation.assertCurrent(token); }, editingBlocked: () => false,
		commit: command => { project = applyFramescaperProjectCommandFinishing(PROFILE, project, command); return view(project); },
		publishDocumentSnapshot() {},
	});
	return { service, initial, effects: () => view(cloneFramescaperProjectFinishing(PROFILE, project)).clips.find(clip => clip.id === 'video-clip')?.videoEffects ?? [] };
}

test('real Frame authoring persists true crop and renders centered contain without stretching the fixed canvas', async () => {
	const authored = author();
	authored.service.addVideoClipEffect('video-clip', 'develop-geometry-v1', { id: 'crop', params: { cropX: 0.25, cropWidth: 0.5 } });
	const source = pixels([1, 2, 3, 4, 5, 6, 7, 8]), frame = { width: 4, height: 2, pixels: source };
	const output = await applyVideoExactBrowserEffectsFinishing(frame, authored.effects(), LIVE);
	assert.deepEqual([output.width, output.height], [4, 2]);
	assert.deepEqual(output.pixels, pixels([0, 2, 3, 0, 0, 6, 7, 0]));
	assert.deepEqual(source, pixels([1, 2, 3, 4, 5, 6, 7, 8]));
	assert.equal(view(authored.initial).clips.find(clip => clip.id === 'video-clip')?.videoEffects?.length ?? 0, 0);
	authored.service.updateVideoClipEffect('video-clip', 'crop', { params: { rotationDegrees: 90, flipHorizontal: 1 } });
	assert.deepEqual((await applyVideoExactBrowserEffectsFinishing(frame, authored.effects(), LIVE)).pixels, pixels([0, 2, 6, 0, 0, 3, 7, 0]));
});

test('Frame aspect presets and actual non-affine perspective share the declared photo geometry kernel', async () => {
	const aspect = createVideoEffect('develop-geometry-v1', { params: { aspect: 2 } });
	assert.deepEqual((await applyVideoExactBrowserEffectsFinishing({ width: 4, height: 2, pixels: pixels([1, 2, 3, 4, 5, 6, 7, 8]) }, [aspect], LIVE)).pixels,
		pixels([0, 2, 3, 0, 0, 6, 7, 0]));
	const effect = createVideoEffect('develop-geometry-v1', { params: { perspective: 1, bottomRightX: 0.75, bottomLeftX: 0.25 } });
	const source = new Uint8Array([0, 10, 20, 255, 100, 110, 120, 255, 50, 60, 70, 255, 150, 160, 170, 255]);
	assert.deepEqual(Array.from((await applyVideoExactBrowserEffectsFinishing({ width: 2, height: 2, pixels: source }, [effect], LIVE)).pixels),
		[25, 35, 45, 255, 105, 115, 125, 255, 71, 81, 91, 255, 129, 139, 149, 255]);
});

test('Frame geometry refuses singular authored state before source/render resources', async () => {
	assert.throws(() => createVideoEffect('develop-geometry-v1', { params: { perspective: 1, topRightX: 0 } }), /convex/iu);
	const stop = new AbortController(); const reason = new Proxy({}, { get() { throw new Error('opaque'); } }); stop.abort(reason);
	const outcome = await applyVideoExactBrowserEffectsFinishing({ width: 1, height: 1, pixels: pixels([1]) }, [], stop.signal)
		.then(() => ({ error: undefined as unknown }), error => ({ error: error as unknown }));
	assert.equal(outcome.error === reason, true);
});

test('Frame geometry admits bounded native source bytes before any copy even when the authored effect is disabled', async () => {
	for (const enabled of [true, false]) {
		let copies = 0, reads = 0;
		const effect = createVideoEffect('develop-geometry-v1', { enabled });
		const invalid = { width: 65_536, height: 65_536, pixels: { slice() { copies++; return new Uint8Array(4); } } };
		await assert.rejects(applyVideoExactBrowserEffectsFinishing(invalid as unknown as { width: number; height: number; pixels: Uint8Array<ArrayBuffer> }, [effect], LIVE));
		assert.equal(copies, 0);
		const accessor = Object.defineProperty({ height: 1, pixels: pixels([1]) }, 'width', { enumerable: true, get() { reads++; return 1; } });
		await assert.rejects(applyVideoExactBrowserEffectsFinishing(accessor as { width: number; height: number; pixels: Uint8Array<ArrayBuffer> }, [effect], LIVE));
		assert.equal(reads, 0);
		const source = pixels([1]); Object.defineProperty(source, 'slice', { get() { copies++; throw new Error('Borrowed copy method'); } });
		assert.deepEqual((await applyVideoExactBrowserEffectsFinishing({ width: 1, height: 1, pixels: source }, [effect], LIVE)).pixels, pixels([1]));
		assert.equal(copies, 0);
	}
});

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoEffectService, type VideoEffectProject } from '../src/common/editor/controller/clip-video/video-effect-service.ts';
import { EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectFinishing, cloneFramescaperProjectFinishing } from '../src/framescaper/editor-project-finishing.ts';
import { applyFramescaperProjectCommandFinishing } from '../src/framescaper/editor-project-finishing-commands.ts';
import { applyVideoExactBrowserEffectsFinishing } from '../src/framescaper/editor-video-exact-browser-effects-finishing.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { defaultImageDevelopStateV1, normalizeImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { withPhotoDevelopProxyV1 } from '../src/lightscaper/controller/photo-develop-proxy-v1.ts';

for (const [type, params, source, expected] of [
	['point-curves-v1', { master: [{ x: 0, y: 1 }, { x: 1, y: 0 }] }, [0, 64, 255, 127], [255, 191, 0, 127]],
	['parametric-curves-v1', { masterShadows: 100 }, [0, 32, 64, 1], [0, 64, 80, 1]],
] as const) test(`real Frames effect service persists and renders shared ${type} parameters`, async () => {
	let project = createFramescaperProjectFinishing(PROFILE, framescaperV20Options());
	const view = (value: unknown) => value as VideoEffectProject, generation = new EditorProjectGeneration(); generation.activate(view(project).id);
	const service = createVideoEffectService({ state: { selectedClipId: 'video-clip', readOnly: false, videoEffectGestures: new Map() },
		copy: { projectReadOnly: 'Read only' }, getProject: () => view(project), captureProject: () => generation.capture(view(project).id),
		assertProject: token => { generation.assertCurrent(token); }, editingBlocked: () => false,
		commit: command => { project = applyFramescaperProjectCommandFinishing(PROFILE, project, command); return view(project); }, publishDocumentSnapshot() {},
	});
	service.addVideoClipEffect('video-clip', type, { id: 'curve', params });
	const clip = view(cloneFramescaperProjectFinishing(PROFILE, project)).clips.find(row => row.id === 'video-clip');
	assert.deepEqual(clip?.videoEffects?.map(row => row.type), [type]);
	const frame = { width: 1, height: 1, pixels: new Uint8Array(source) };
	const rendered = await applyVideoExactBrowserEffectsFinishing(frame, clip?.videoEffects ?? [], new AbortController().signal);
	assert.deepEqual([...rendered.pixels], expected); assert.deepEqual([...frame.pixels], source);
});

test('real Frame and serial Photo proxy both preserve65 authored curves while old numeric admission stays closed', async () => {
	const effects = Array.from({ length: 65 }, (_, n) => createVideoEffect('point-curves-v1', { id: `curve-${String(n)}`,
		params: n === 64 ? { master: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } : {} }));
	const context = framescaperV20Options(), clips = context.clips as readonly Readonly<{ id: string }>[];
	const project = createFramescaperProjectFinishing(PROFILE, { ...context,
		clips: clips.map(clip => clip.id === 'video-clip' ? { ...clip, videoEffects: effects } : clip) });
	const clip = (cloneFramescaperProjectFinishing(PROFILE, project) as unknown as VideoEffectProject).clips.find(row => row.id === 'video-clip')!;
	assert.equal(clip.videoEffects!.length, 65);
	const frame = { width: 1, height: 1, pixels: new Uint8Array([32,64,128,0]) };
	assert.deepEqual([...(await applyVideoExactBrowserEffectsFinishing(frame, clip.videoEffects!, new AbortController().signal)).pixels], [223,191,127,0]);
	assert.deepEqual([...frame.pixels], [32,64,128,0]);
	const develop = normalizeImageDevelopStateV1({ ...defaultImageDevelopStateV1(), effects });
	assert.equal(develop.effects.length, 65);
	assert.deepEqual(await withPhotoDevelopProxyV1({ develop, frame: {
		descriptor: { schemaVersion: 1, width: 1, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: frame.pixels,
	} }, view => [...view.frame.pixels]), [223,191,127,0]);
	assert.deepEqual([...frame.pixels], [32,64,128,0]);
	assert.throws(() => createVideoEffect('point-curves-v1', { id: 'x'.repeat(129) }));
	assert.throws(() => createVideoEffect('tone-ladder-v1', { params: { exposure: [{ x: 0, y: 0 }, { x: 1, y: 1 }] } }));
});

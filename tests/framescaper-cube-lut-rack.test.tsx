/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import VideoEffectRack from '../src/common/editor/ui/inspector/VideoEffectRack.jsx';
import { VIDEO_EFFECT_COPY_BY_LOCALE } from '../src/common/i18n/video-effect-copy.js';
import { VIDEO_EFFECT_TYPES_V2 } from '../src/common/editor/video-effects-v2.ts';
import { bindCubeLutEffectPortV1 } from '../src/common/editor/controller/clip-video/cube-lut-effect-port-v1.ts';
import { createFramescaperCubeLutEffectActionsFinishing } from '../src/framescaper/editor-cube-lut-effect-actions-finishing.ts';
import { createFramescaperCubeLutSourceFinishing } from '../src/framescaper/cube-lut-source-finishing.ts';
import { applyVideoExactBrowserEffectsFinishingV2 } from '../src/framescaper/editor-video-exact-browser-effects-finishing-v2.ts';
import { createFramescaperProjectFinishing, cloneFramescaperProjectFinishing } from '../src/framescaper/editor-project-finishing.ts';
import { applyFramescaperProjectCommandFinishing } from '../src/framescaper/editor-project-finishing-commands.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createVideoEffectService, type VideoEffectProject } from '../src/common/editor/controller/clip-video/video-effect-service.ts';
import { EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { settle } from './helpers/async-test-control.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

const BODY = 'LUT_3D_SIZE 2\n0 0 0\n0 0 1\n0 1 0\n0 1 1\n1 0 0\n1 0 1\n1 1 0\n1 1 1';
const view = (value: unknown) => value as VideoEffectProject;
for (const locale of ['en', 'de'] as const) test(`${locale}: the existing opted-in Frame rack authors a resource profile and persists authenticated immutable bytes before exact rendering`, async context => {
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'React'); Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	context.after(() => { if (previous) Object.defineProperty(globalThis, 'React', previous); else Reflect.deleteProperty(globalThis, 'React'); });
	let project = createFramescaperProjectFinishing(PROFILE, framescaperV20Options()), error = '', pending: Promise<unknown> | undefined;
	const generation = new EditorProjectGeneration(); generation.activate(view(project).id);
	const commit = (command: unknown) => { project = applyFramescaperProjectCommandFinishing(PROFILE, project, command); return view(project); };
	const service = createVideoEffectService({ state: { selectedClipId: 'video-clip', readOnly: false, videoEffectGestures: new Map() }, copy: { projectReadOnly: 'Read only' },
		getProject: () => view(project), captureProject: () => generation.capture(view(project).id), assertProject: token => { generation.assertCurrent(token); },
		editingBlocked: () => false, commit, publishDocumentSnapshot() {} });
	const controller = { get project() { return project; }, actions: { edit: { commit }, video: { effects: {
		add: service.addVideoClipEffect, beginGesture: service.beginVideoEffectGesture, preview: service.previewVideoEffectGesture,
		commit: service.commitVideoEffectGesture, cancel: service.cancelVideoEffectGesture, toggle: service.toggleVideoClipEffect,
		reorder: service.reorderVideoClipEffect, remove: service.removeVideoClipEffect, update: service.updateVideoClipEffect } } } };
	const bodies = new Map<string, Blob>();
	const store = { getMediaAssetMetadata: (key: string) => Promise.resolve(bodies.has(key) ? {} : null), loadMediaAsset: (key: string) => Promise.resolve(bodies.get(key) ?? null),
		beginMediaAssetWrite(key: string) { const chunks: Uint8Array<ArrayBuffer>[] = []; return Promise.resolve({ maximumChunkBytes: 17, bytesWritten: 0,
			write(bytes: Uint8Array) { chunks.push(new Uint8Array(bytes)); return Promise.resolve(); },
			commit() { bodies.set(key, new Blob(chunks)); return Promise.resolve({}); }, abort() { return Promise.resolve(); } }); } };
	const owner = createFramescaperCubeLutEffectActionsFinishing({ owner: controller, store });
	bindCubeLutEffectPortV1(controller, { ...owner, importFile(binding, file, options) { const result = owner.importFile(binding, file, options); pending = result; return result; } });
	const copy = { ...VIDEO_EFFECT_COPY_BY_LOCALE[locale], chooseEffect: 'Choose effect', addEffect: 'Add effect' };
	const mounted = await mountPhotoImportUi(() => <VideoEffectRack clip={view(project).clips.find(row => row.id === 'video-clip')}
		controller={controller} copy={copy} disabled={false} onError={(value: string) => { error = value; }} />);
	const key = async (name: string) => { await act(async () => { reactProps(mounted.dom.one('.dropdown')).onKeyDown?.({ key: name, preventDefault() {} }); }); };
	try {
		await key('Enter');
		for (let index = 0; index < VIDEO_EFFECT_TYPES_V2.indexOf('cube-lut-profile-v1'); index++) await key('ArrowDown');
		await key('Enter'); assert.ok(mounted.dom.one('.dropdown').textContent.includes(copy.videoEffectCubeLutProfile));
		const add = mounted.dom.container.querySelectorAll('button').find(row => row.textContent === 'Add effect'); assert.ok(add);
		await act(async () => { reactProps(add).onClick?.({}); await settle(); }); await mounted.render();
		const input = mounted.dom.container.querySelectorAll('input').find(row => row.getAttribute('aria-label') === copy.videoEffectCubeLutImport); assert.ok(input);
		await act(async () => { reactProps(input).onChange?.({ currentTarget: { files: [new File([BODY], 'literal.cube')], value: 'selected' } }); await pending; }); await mounted.render();
		const restored = view(cloneFramescaperProjectFinishing(PROFILE, project)).clips.find(row => row.id === 'video-clip')!;
		assert.equal(error, ''); assert.equal(restored.videoEffects?.[0]?.type, 'cube-lut-profile-v1'); assert.equal(bodies.size, 1);
		const source = createFramescaperCubeLutSourceFinishing(store), original = new Uint8Array([64, 91, 32, 127]);
		const rendered = await applyVideoExactBrowserEffectsFinishingV2({ width: 1, height: 1, pixels: original }, restored.videoEffects!, new AbortController().signal, { source });
		assert.deepEqual([...rendered.pixels], [32, 91, 64, 127]); assert.deepEqual([...original], [64, 91, 32, 127]); await source.close();
		const clear = mounted.dom.container.querySelectorAll('button').find(row => row.textContent === copy.videoEffectCubeLutClear); assert.ok(clear);
		await act(async () => { reactProps(clear).onClick?.({}); await settle(); }); await mounted.render();
		assert.equal(view(project).clips.find(row => row.id === 'video-clip')?.videoEffects?.[0]?.params.lut, null); assert.equal(bodies.size, 1);
	} finally { await mounted.dispose(); await owner.close(); }
});

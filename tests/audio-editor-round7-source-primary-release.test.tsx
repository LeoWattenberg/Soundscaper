/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import ClipSourceEditor from '../src/common/editor/ui/inspector/ClipSourceEditor.tsx';
import type { ClipSourceController, ClipSourceProject, SourceSelection } from '../src/common/editor/ui/inspector/clip-source-editor-types.ts';
import { createClipSourcePreviewService } from '../src/common/editor/controller/clip-video/internal/clip-source-preview-service.ts';
import type { ClipSourcePreviewProject } from '../src/common/editor/controller/clip-video/internal/clip-source-preview-project.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const buttons of [4, 2]) for (const phase of ['release', 'foreign', 'auxiliary', 'touch', 'pen'] as const) {
	test(`Source selection respects ${phase} with held mouse buttons ${String(buttons)}`, async () => {
		const f = await fixture();
		try {
			await f.send('onPointerDown', 1, 200);
			await f.send('onPointerMove', 1, 400);
			assert.equal(f.preview.snapshot().selection, null);
			await f.send('onPointerMove', phase === 'foreign' ? 2 : 1, 400, true,
				phase === 'touch' || phase === 'pen' ? phase : 'mouse', phase === 'auxiliary' ? 1 : 0,
				phase === 'auxiliary' ? buttons | 1 : buttons);
			if (phase === 'release') {
				assert.deepEqual(f.preview.snapshot().selection, { startFrame: 200, endFrame: 400 });
				assert.deepEqual(f.effectSelection(), { clipId: 'clip', startFrame: 200, endFrame: 400 });
				await f.send('onPointerMove', 1, 500, true, 'mouse', -1, buttons);
				await f.cancelSelection('pointercancel');
				await f.send('onPointerUp', 1, 500, true, 'mouse', buttons === 4 ? 1 : 2, 0);
				assert.deepEqual(f.preview.snapshot().selection, { startFrame: 200, endFrame: 400 });
				assert.deepEqual(f.effectSelection(), { clipId: 'clip', startFrame: 200, endFrame: 400 });
			} else {
				assert.equal(f.preview.snapshot().selection, null);
				await f.send('onPointerMove', 1, 500);
				await f.send('onPointerUp', 1, 500);
				assert.deepEqual(f.preview.snapshot().selection, { startFrame: 200, endFrame: 500 });
				assert.deepEqual(f.effectSelection(), { clipId: 'clip', startFrame: 200, endFrame: 500 });
			}
		} finally { await f.cleanup(); }
	});
}

async function fixture() {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	let project: ClipSourcePreviewProject & ClipSourceProject = {
		id: 'project', sampleRate: 48_000,
		tempoMap: { mode: 'musical', events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }] },
		sources: [{ id: 'source', sampleRate: 48_000, channelCount: 1, frameCount: 1_000 }],
		clips: [{ id: 'clip', sourceId: 'source', kind: 'audio', anchor: 'sample', timelineStartFrame: 2_000,
			sourceStartFrame: 100, sourceDurationFrames: 400, durationFrames: 400 }],
	};
	const generation = new EditorProjectGeneration();
	generation.activate(project.id);
	const preview = createClipSourcePreviewService({
		lifetime: new EditorControllerLifetime(), getProject: () => project,
		captureProject: () => generation.capture(), assertProject: token => generation.assertCurrent(token),
		handleError: error => { throw error; },
	});
	preview.focus('clip');
	let effectSelection: (SourceSelection & { readonly clipId: string }) | null = null;
	const noop = () => undefined;
	const markerMoves: unknown[][] = [];
	const controller: ClipSourceController = { getClipVisualData: () => null, actions: {
		clip: { update: noop }, audioWarp: { addSourceMarker: noop, moveSourceMarker: (...args: unknown[]) => { markerMoves.push(args); }, deleteSourceMarker: noop }, timeline: {},
		effects: { setSourceSelection: value => { effectSelection = value; } },
		clipSourcePreview: { ...preview, trim: noop },
	} };
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const render = async (changes: Partial<ClipSourceProject['clips'][number]> = {}) => {
		project = { ...project, clips: [{ ...project.clips[0]!, ...changes }] };
		await act(async () => { root.render(<ClipSourceEditor controller={controller} project={project} clipId="clip" copy={ENGLISH_COPY} blocked={false} />); });
	};
	await render();
	const wave = dom.one('.audio-editor-source-wave-area');
	Object.defineProperty(wave, 'getBoundingClientRect', { value: () => ({ left: 0, width: 1_000 }) });
	Object.defineProperty(wave, 'setPointerCapture', { value: noop });
	const event = { button: 0, pointerId: 1, preventDefault: noop, stopPropagation: noop };
	return {
		render, preview, markerMoves, effectSelection: () => effectSelection,
		send: async (kind: 'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel', pointerId: number, clientX: number, isPrimary = true, pointerType = 'mouse', button = 0, buttons = 1) => {
			await act(async () => { reactProps(wave)[kind]({ ...event, pointerId, clientX, isPrimary, pointerType, button, buttons }); });
		},
		pressMarker: async (index: number, key: string) => {
			const marker = dom.container.querySelectorAll('.audio-editor-source-stretch-marker')[index]!;
			await act(async () => { reactProps(marker).onKeyDown({ ...event, key }); });
		},
		fadeHandle: (edge: string) => dom.find(`[data-clip-fade-handle="${edge}"]`),
		highlight: () => {
			const highlight = dom.find('.audio-editor-source-selection');
			return highlight ? [Reflect.get(highlight.style, 'left'), Reflect.get(highlight.style, 'width')] : null;
		},
		dragSelection: async (startFrame: number, endFrame: number) => {
			await act(async () => { reactProps(wave).onPointerDown({ ...event, clientX: startFrame }); });
			await act(async () => { reactProps(wave).onPointerMove({ ...event, clientX: endFrame }); });
		},
		cancelSelection: async (method: 'Escape' | 'pointercancel') => {
			await act(async () => {
				if (method === 'Escape') reactProps(dom.one('.audio-editor-clip-source-editor')).onKeyDownCapture({ ...event, key: 'Escape' });
				else reactProps(wave).onPointerCancel(event);
			});
		},
		select: async (startFrame: number, endFrame: number) => {
			await act(async () => { reactProps(wave).onPointerDown({ ...event, clientX: startFrame }); });
			await act(async () => { reactProps(wave).onPointerUp({ ...event, clientX: endFrame }); });
		},
		cleanup: async () => {
			await act(async () => { root.unmount(); });
			await preview.dispose();
			actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
			if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		},
	};
}

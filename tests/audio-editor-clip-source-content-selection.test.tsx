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

test('source edits refresh the effect target without requiring another focus event', async () => {
	const f = await fixture();
	try {
		assert.deepEqual(f.effectSelection(), { clipId: 'clip', startFrame: 100, endFrame: 500 });
		await f.render({ sourceStartFrame: 200, sourceDurationFrames: 300, durationFrames: 150 });
		assert.deepEqual(f.effectSelection(), { clipId: 'clip', startFrame: 200, endFrame: 500 });
		assert.equal(f.preview.snapshot().durationFrames, 850);
		assert.equal(f.preview.snapshot().focused, true);
	} finally { await f.cleanup(); }
});

test('a retained source highlight follows the updated source-to-display mapping', async () => {
	const f = await fixture();
	try {
		await f.select(250, 350);
		assert.deepEqual(f.effectSelection(), { clipId: 'clip', startFrame: 250, endFrame: 350 });
		await f.render({ sourceStartFrame: 200, sourceDurationFrames: 300, durationFrames: 150 });
		assert.deepEqual(f.preview.snapshot().selection, { startFrame: 250, endFrame: 350 });
		assert.deepEqual(f.effectSelection(), { clipId: 'clip', startFrame: 300, endFrame: 500 });
	} finally { await f.cleanup(); }
});

test('background clip edits leave source ownership with the main timeline', async () => {
	const f = await fixture();
	try {
		await act(async () => { f.preview.blur(); });
		assert.equal(f.effectSelection(), null);
		await f.render({ sourceStartFrame: 200, sourceDurationFrames: 300, durationFrames: 150 });
		assert.equal(f.effectSelection(), null);
		assert.equal(f.preview.snapshot().focused, false);
	} finally { await f.cleanup(); }
});

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
	const controller: ClipSourceController = { getClipVisualData: () => null, actions: {
		clip: { update: noop }, audioWarp: { addSourceMarker: noop, moveSourceMarker: noop, deleteSourceMarker: noop }, timeline: {},
		effects: { setSourceSelection: value => { effectSelection = value; } },
		clipSourcePreview: { ...preview, trim: noop },
	} };
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const render = async (changes: Readonly<Record<string, number>> = {}) => {
		project = { ...project, clips: [{ ...project.clips[0]!, ...changes }] };
		await act(async () => { root.render(<ClipSourceEditor controller={controller} project={project} clipId="clip" copy={ENGLISH_COPY} blocked={false} />); });
	};
	await render();
	return {
		render, preview, effectSelection: () => effectSelection,
		select: async (startFrame: number, endFrame: number) => {
			const wave = dom.one('.audio-editor-source-wave-area');
			Object.defineProperty(wave, 'getBoundingClientRect', { value: () => ({ left: 0, width: 1_000 }) });
			Object.defineProperty(wave, 'setPointerCapture', { value: noop });
			const event = { button: 0, pointerId: 1, preventDefault: noop, stopPropagation: noop };
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

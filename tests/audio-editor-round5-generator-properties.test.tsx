/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import ClipPropertiesPanel from '../src/common/editor/ui/inspector/ClipPropertiesPanel.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createEditorProjectRuntimeSelection } from '../src/framescaper/editor-project-runtime-selection.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { framescaperBaselineOptions } from './helpers/framescaper-baseline-model-fixture.ts';
import { normalizeVideoGeneratorClipV1, normalizeVideoGeneratorSourceV1 } from '../src/common/editor/video-visual-model-v24.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('generator Properties commits native duration without invoking the audio source editor', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const runtime = createEditorProjectRuntimeSelection(FRAMESCAPER_PROJECT_RUNTIME_PROFILE);
	let history = runtime.createHistory(createFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, framescaperBaselineOptions()));
	const source = normalizeVideoGeneratorSourceV1({ schemaVersion: 1, kind: 'generator', id: 'title-source', name: 'Title',
		width: 1920, height: 1080, frameRate: { num: 30, den: 1 }, frameCount: 150,
		generator: { kind: 'title', text: 'Title', fontFamily: 'soundscaper-sans', fontSize: 96,
			color: '#ffffffff', horizontalAlign: 'center', verticalAlign: 'middle' } });
	const clip = normalizeVideoGeneratorClipV1({ schemaVersion: 1, kind: 'generator', id: 'title', sourceId: source.id,
		sequenceId: history.present.primarySequenceId, sequenceStartFrame: 0, sequenceFrameCount: 150, sourceInFrame: 0, sourceFrameCount: 150 });
	const trackId = history.present.tracks.find(item => item.type === 'video')?.id;
	assert.ok(trackId);
	history = runtime.executeCommand(history, { type: 'batch', commands: [
		{ type: 'video-visual-source/set', sourceId: source.id, expectedSource: null, source },
		{ type: 'video-visual-clip/set', clipId: clip.id, expectedClip: null, expectedPlacement: null, clip,
			placement: { scope: 'timeline', trackId } },
	] });
	history = runtime.createHistory(history.present);
	let audioCalls = 0;
	const controller = { actions: { clip: { trim: (clipId: string, changes: Readonly<{ durationFrames: number }>) => {
		history = runtime.executeCommand(history, { type: 'clip/trim', clipId, ...changes });
	} }, clipSourcePreview: { trim() { audioCalls += 1; throw new Error('The source editor requires an available audio clip.'); } } } };
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => { root.render(<ClipPropertiesPanel controller={controller}
			runtimeProject={runtime.projectForRuntimeConsumers(history.present)}
			snapshot={{ project: history.present, selectedClipId: clip.id, capabilities: { audioEffects: false, videoEffects: true } }} copy={ENGLISH_COPY} />); });
		const field = dom.one('[data-clip-field="durationFrame"]');
		const input = field.querySelector('input'); const wrapper = field.querySelector('[data-timecode-input]');
		assert.ok(input && wrapper);
		await act(async () => { reactProps(input).onChange({ currentTarget: { valueAsNumber: 96_000 } }); });
		await act(async () => { reactProps(wrapper).onBlur({ currentTarget: wrapper, relatedTarget: null }); });
		assert.equal(audioCalls, 0, 'generator timing is not audio-source trimming');
		const saved = history.present.clips.find(item => item.id === clip.id);
		assert.equal(saved?.sequenceFrameCount, 20, "two seconds in the fixture's 10 fps sequence");
		assert.equal(saved?.sourceFrameCount, 20);
		assert.deepEqual(runtime.undo(history).present.clips.find(item => item.id === clip.id), clip);
		assert.equal(dom.container.querySelector('[data-clip-field="gain"]'), null);
		assert.equal(dom.container.querySelector('[data-clip-properties-drawer="fading"]'), null);
	} finally {
		await act(async () => { root.unmount(); }); dom.restore();
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact); else Reflect.deleteProperty(globalThis, 'React');
	}
});

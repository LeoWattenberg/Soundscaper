/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import React, { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import ClipPropertiesBody from '../src/common/editor/ui/inspector/ClipPropertiesBody.jsx';
import ImageClipPropertiesBody from '../src/common/editor/ui/inspector/ImageClipPropertiesBody.tsx';
import GeneratorClipPropertiesBody from '../src/common/editor/ui/inspector/GeneratorClipPropertiesBody.tsx';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createFramescaperBaselineImageFixture } from './helpers/framescaper-baseline-image-fixture.ts';
import { createPersistedVideoProject } from './helpers/persisted-video-project-fixture.ts';
import { installReactTestDom, reactProps, type ReactTestDom } from './helpers/react-test-dom.ts';

async function mount(context: TestContext, element: ReactElement) {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const root = createRoot(dom.container as unknown as Element);
	context.after(async () => {
		await act(async () => { root.unmount(); });
		globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	});
	await act(async () => { root.render(element); });
	return dom;
}

async function changeDuration(dom: ReactTestDom) {
	const field = dom.one('[data-clip-field="durationFrame"]');
	const input = field.querySelector('input');
	const wrapper = field.querySelector('[data-timecode-input]');
	assert.ok(input && wrapper);
	await act(async () => { reactProps(input).onChange({ currentTarget: { valueAsNumber: 20 } }); });
	await act(async () => { reactProps(wrapper).onBlur({ currentTarget: wrapper, relatedTarget: null }); });
}

test('legacy video properties routes the original failed edit to the host error boundary', async context => {
	const project = resolveRuntimeProjectProjection(createPersistedVideoProject({ timeline: true }).project);
	const failure = new RangeError('Native video placement refused');
	const errors: unknown[] = [];
	const controller = { actions: { clip: { update() { throw failure; } } } };
	const dom = await mount(context, <ClipPropertiesBody controller={controller} copy={ENGLISH_COPY}
		snapshot={{ project, selectedClipId: 'persisted-timeline-video', capabilities: {} }} onError={cause => errors.push(cause)} />);
	const input = dom.one('[data-clip-field="name"]').querySelector('input');
	assert.ok(input);
	await act(async () => { reactProps(input).onChange({ target: { value: 'Changed video name' } }); });
	await act(async () => { reactProps(input).onBlur(); });
	assert.deepEqual(errors, [failure]);
	assert.equal(dom.container.querySelectorAll('[role="alert"]').length, 0);
});

test('legacy image properties routes the original native commit refusal without an inline alert', async context => {
	const { project, clip } = createFramescaperBaselineImageFixture({ imageOnly: true });
	const failure = new RangeError('Image placement refused');
	const errors: unknown[] = [];
	const controller = { actions: { edit: { commit() { throw failure; } } } };
	const dom = await mount(context, <ImageClipPropertiesBody controller={controller} project={project} clipId={clip.id}
		copy={ENGLISH_COPY} disabled={false} onError={cause => errors.push(cause)} />);
	await changeDuration(dom);
	assert.deepEqual(errors, [failure]);
	assert.equal(dom.container.querySelectorAll('[role="alert"]').length, 0);
});

test('legacy generator properties routes the original trim refusal without an inline alert', async context => {
	const failure = new RangeError('Generated clip trim refused');
	const errors: unknown[] = [];
	const project = { sampleRate: 48_000, clips: [{ id: 'clip', kind: 'generator', sourceId: 'source', timelineStartFrame: 0, durationFrames: 48_000 }],
		sources: [{ id: 'source', name: 'Title' }], tracks: [{ id: 'track', clipIds: ['clip'] }] };
	const controller = { actions: { clip: { trim() { throw failure; } } } };
	const dom = await mount(context, <GeneratorClipPropertiesBody controller={controller} project={project} clipId="clip"
		copy={ENGLISH_COPY} disabled={false} onError={cause => errors.push(cause)} />);
	await changeDuration(dom);
	assert.deepEqual(errors, [failure]);
	assert.equal(dom.container.querySelectorAll('[role="alert"]').length, 0);
});

test('legacy asynchronous clip operations route raw rejections to the host', async context => {
	const project = resolveRuntimeProjectProjection(createPersistedVideoProject({ timeline: true }).project);
	const failure = new Error('Audio normalization refused');
	const errors: unknown[] = [];
	const controller = { actions: { clip: { normalizePeak: () => Promise.reject(failure) } } };
	const dom = await mount(context, <ClipPropertiesBody controller={controller} copy={ENGLISH_COPY}
		snapshot={{ project, selectedClipId: 'persisted-timeline-audio', capabilities: { audioEffects: true } }} onError={cause => errors.push(cause)} />);
	const button = dom.one('[data-clip-action="normalize-peak"]').querySelector('button');
	assert.ok(button);
	await act(async () => { reactProps(button).onClick(); });
	assert.deepEqual(errors, [failure]);
	assert.equal(dom.container.querySelectorAll('[role="alert"]').length, 0);
});

test('legacy video rack errors route their existing nonempty message without publishing reset messages', async context => {
	const project = resolveRuntimeProjectProjection(createPersistedVideoProject({ timeline: true }).project);
	const failure = new Error('Video effect refused');
	const errors: unknown[] = [];
	const controller = { actions: { clip: {}, video: { effects: { add() { throw failure; } } } } };
	const dom = await mount(context, <ClipPropertiesBody controller={controller} copy={ENGLISH_COPY}
		snapshot={{ project, selectedClipId: 'persisted-timeline-video', capabilities: { videoEffects: true } }} onError={cause => errors.push(cause)} />);
	const button = dom.one('[data-video-effect-add]').querySelector('button');
	assert.ok(button);
	await act(async () => { reactProps(button).onClick(); });
	assert.deepEqual(errors, ['Video effect refused']);
	assert.equal(dom.container.querySelectorAll('[role="alert"]').length, 0);
});

test('standalone image properties retains its local error fallback without a host boundary', async context => {
	const { project, clip } = createFramescaperBaselineImageFixture({ imageOnly: true });
	const controller = { actions: { edit: { commit() { throw new Error('Standalone image edit refused'); } } } };
	const dom = await mount(context, <ImageClipPropertiesBody controller={controller} project={project} clipId={clip.id}
		copy={ENGLISH_COPY} disabled={false} />);
	await changeDuration(dom);
	assert.equal(dom.one('[role="alert"]').textContent, 'Standalone image edit refused');
});

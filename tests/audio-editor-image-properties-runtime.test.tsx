/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import ClipPropertiesPanel from '../src/common/editor/ui/inspector/ClipPropertiesPanel.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createEditorProjectRuntimeSelection } from '../src/framescaper/editor-project-runtime-selection.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperBaselineImageFixture } from './helpers/framescaper-baseline-image-fixture.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('image Properties consumes the selected product projection and commits only native image timing', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const { project, clip } = createFramescaperBaselineImageFixture({ imageOnly: true });
	const runtime = createEditorProjectRuntimeSelection(FRAMESCAPER_PROJECT_RUNTIME_PROFILE);
	let history = runtime.createHistory(project);
	const controller = { actions: { edit: { commit: (command: unknown) => {
		history = runtime.executeCommand(history, command);
	} } } };
	const props = { controller, runtimeProject: runtime.projectForRuntimeConsumers(project),
		snapshot: { project, selectedClipId: clip.id, capabilities: { audioEffects: false, videoEffects: true } }, copy: ENGLISH_COPY };
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => { root.render(<ClipPropertiesPanel {...props} />); });
		const duration = dom.one('[data-clip-field="durationFrame"]');
		const input = duration.querySelector('input');
		const wrapper = duration.querySelector('[data-timecode-input]');
		assert.ok(input && wrapper);
		assert.equal(dom.container.querySelector('[data-clip-properties-drawer="fading"]'), null);
		assert.equal(dom.container.querySelector('[data-clip-field="gain"]'), null);
		assert.equal(dom.container.querySelector('[data-clip-field="sourceInFrame"]'), null);
		await act(async () => { reactProps(input).onChange({ currentTarget: { valueAsNumber: 20 } }); });
		await act(async () => { reactProps(wrapper).onBlur({ currentTarget: wrapper, relatedTarget: null }); });
		assert.deepEqual(history.present.clips.find(item => item.id === clip.id), { ...clip, sequenceFrameCount: 20 });
		const reverted = runtime.undo(history);
		assert.deepEqual(reverted.present.clips.find(item => item.id === clip.id), clip);
	} finally {
		await act(async () => { root.unmount(); });
		dom.restore();
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
	}
});

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import FramescaperSelectedVisualAuthoringDialog from '../src/common/editor/ui/dialogs/FramescaperSelectedVisualAuthoringDialog.tsx';
import { bindFramescaperSelectedAuthoringController } from '../src/framescaper/editor-selected-finishing-authoring-controller.ts';
import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import type { AudioEditorProjectStore } from '../src/common/editor/storage.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('the production adjustment dialog refuses a locked owner and resumes after unlocking', async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as HTMLElement);
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	let project = {
		schemaFamily: 'framescaper', schemaVersion: 1, id: 'project', revision: 0, sampleRate: 48_000,
		selection: { clipIds: ['picture'] }, primarySequenceId: 'sequence',
		sequences: [{ id: 'sequence', trackIds: ['track'], rate: { num: 30, den: 1 } }],
		tracks: [{ id: 'track', type: 'video', clipIds: ['picture'], locked: true }],
		clips: [{ id: 'picture', kind: 'video', sourceId: 'source', sequenceId: 'sequence',
			sequenceStartFrame: 0, sequenceFrameCount: 10, sourceInFrame: 0, sourceFrameCount: 10, retimeMap: null }],
		sources: [createVideoSource({ id: 'source', name: 'Picture', storageKey: 'source', mimeType: 'video/mp4',
			contentSha256: 'ab'.repeat(32), sampleFrameCount: 16_000, sourceFrameCount: 10,
			frameRate: { num: 30, den: 1 }, width: 640, height: 360 })],
		videoAdjustmentLayers: [], videoVisualPresentations: [], videoMaskMattes: [],
		videoVisualPresets: [], videoFinishingPresets: [], videoFreezeFallbacks: [],
	};
	const commits: unknown[] = [];
	const controller = { get project() { return project; },
		getSnapshot: () => ({ selectedClipId: 'picture' }), getTelemetrySnapshot: () => ({ positionFrame: 0 }),
		actions: { edit: { commit(command: unknown) { commits.push(command); } } } };
	bindFramescaperSelectedAuthoringController({ controller, store: {} as AudioEditorProjectStore });
	const render = (): void => { root.render(<FramescaperSelectedVisualAuthoringDialog
		surface="video-adjustment-layer" controller={controller} project={project} selectedClipId="picture"
		playheadSample={0} editingBlocked={false} readOnly={false} run={operation => operation()} onClose={() => {}} />); };
	try {
		await act(async () => { render(); });
		assert.equal(reactProps(dom.one('fieldset')).disabled, true, 'the current locked owner refuses adjustment fields');
		await act(async () => { reactProps(dom.one('[data-framescaper-authoring-apply]')).onClick(); });
		assert.equal(commits.length, 0);
		project = { ...project, tracks: [{ ...project.tracks[0]!, locked: false }] };
		await act(async () => { render(); });
		assert.equal(reactProps(dom.one('fieldset')).disabled, false);
		await act(async () => { reactProps(dom.one('[data-framescaper-authoring-apply]')).onClick(); });
		assert.equal(commits.length, 1, 'an unlocked selected occurrence still reaches its real command builder');
		project = { ...project, tracks: [{ ...project.tracks[0]!, locked: true }] };
		await act(async () => { render(); });
		await act(async () => { reactProps(dom.one('[data-framescaper-authoring-apply]')).onClick(); });
		assert.equal(commits.length, 1, 'a later lock publication also refuses the action handler');
		await act(async () => { root.render(<FramescaperSelectedVisualAuthoringDialog
			surface="video-visual-preset" controller={controller} project={project} selectedClipId="picture"
			playheadSample={0} editingBlocked={false} readOnly={false} run={operation => operation()} onClose={() => {}} />); });
		assert.equal(reactProps(dom.container.querySelectorAll('fieldset')[1]!).disabled, false, 'preset-library operations retain their existing admission');
	} finally {
		await act(async () => { root.unmount(); });
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
		else Reflect.deleteProperty(globalThis, 'React');
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		dom.restore();
	}
});

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import FramescaperFinishingDialog from '../src/common/editor/ui/dialogs/FramescaperFinishingDialog.tsx';
import { bindFramescaperMotionAnalysisActionsFinishing } from '../src/framescaper/editor-motion-analysis-actions-finishing.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('a tracking target appearing in the mounted finishing dialog initializes its native range', async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as HTMLElement);
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const source = { id: 'camera', kind: 'video', frameRate: { num: 15, den: 1 }, sourceFrameCount: 32,
		timingDecision: { mode: 'conform-cfr-at-ingest', rate: { num: 15, den: 1 } } };
	const target = { stackId: 'tracking', sourceId: source.id, sourceName: 'camera.webm', startFrame: 0,
		endFrame: 32, analysisId: 'analysis', freshness: 'missing' as const };
	let targets: readonly typeof target[] = [];
	let project = { schemaFamily: 'framescaper', schemaVersion: 1, sources: [source],
		videoProcessorStacks: [], videoMotionAnalyses: [] };
	const controller = { actions: { edit: { commit() {} } } };
	bindFramescaperMotionAnalysisActionsFinishing(controller, { targets: () => targets,
		analyze: async () => { throw new Error('This field lifecycle does not render media.'); } });
	const render = (): void => { root.render(<FramescaperFinishingDialog surface="motion-tracking"
		controller={controller} project={project} fileService={{}} editingBlocked={false} readOnly={false}
		run={operation => operation()} onClose={() => {}} />); };
	try {
		await act(async () => { render(); });
		assert.equal(dom.find('[data-timecode-direct-entry="true"]'), null);
		targets = [target]; project = { ...project };
		await act(async () => { render(); });
		let inputs = dom.container.querySelectorAll('[data-timecode-direct-entry="true"]');
		assert.deepEqual(inputs.map(input => input.value), ['0', '32']);
		await act(async () => { reactProps(inputs[1]!).onChange?.({ currentTarget: { valueAsNumber: 20 } }); });
		targets = [{ ...target }]; project = { ...project };
		await act(async () => { render(); });
		inputs = dom.container.querySelectorAll('[data-timecode-direct-entry="true"]');
		assert.equal(inputs[1]?.value, '20', 'ordinary project publication must preserve the current range draft');
		targets = [{ ...target, stackId: 'second', endFrame: 12 }]; project = { ...project };
		await act(async () => { render(); });
		inputs = dom.container.querySelectorAll('[data-timecode-direct-entry="true"]');
		assert.deepEqual(inputs.map(input => input.value), ['0', '12']);
	} finally {
		await act(async () => { root.unmount(); });
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
		else Reflect.deleteProperty(globalThis, 'React');
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct; dom.restore();
	}
});

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import LocalAssistanceGuidedSettings from '../src/common/editor/ui/dialogs/LocalAssistanceGuidedSettings.tsx';
import {
	defaultAssistanceWorkflowSettingsV1,
	validateAssistanceWorkflowSettingsV1,
	type AssistanceWorkflowSettingsV1,
} from '../src/common/editor/assistance/workflow-settings-v1.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('Reframe accepts a completed two-digit width without publishing its out-of-range first keystroke', async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as Element);
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const saved: AssistanceWorkflowSettingsV1[] = [];
	let settings = defaultAssistanceWorkflowSettingsV1('reframe');
	const render = () => root.render(<LocalAssistanceGuidedSettings copy={{ localAssistanceAspectWidth: 'Target width' }}
		settings={settings} disabled={false} onChange={(next) => {
			settings = validateAssistanceWorkflowSettingsV1(next);
			saved.push(settings);
			render();
		}} />);
	try {
		await act(async () => render());
		const input = dom.container.querySelectorAll('input')[0]!;
		for (const value of ['', '1', '16']) {
			await act(async () => reactProps(input).onChange({ currentTarget: { value, valueAsNumber: Number(value) } }));
			assert.equal(input.value, value, 'an unfinished native draft remains editable');
			assert.equal(saved.length, 0, 'settings remain valid while a number is unfinished');
		}
		await act(async () => reactProps(input).onBlur());
		assert.equal(saved.length, 1);
		assert.deepEqual(saved[0], { settingsVersion: 1, workflowId: 'reframe', targetAspectWidth: 16, targetAspectHeight: 16 });
		await act(async () => reactProps(input).onChange({ currentTarget: { value: '64', valueAsNumber: 64 } }));
		await act(async () => reactProps(input).onBlur());
		assert.equal(saved.length, 2, 'the exact 4:1 boundary is accepted');
		await act(async () => reactProps(input).onChange({ currentTarget: { value: '65', valueAsNumber: 65 } }));
		await act(async () => reactProps(input).onBlur());
		assert.equal(saved.length, 2);
		assert.equal(input.value, '64', 'an invalid final value restores the saved setting');
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import EditorHelpTooltip from '../src/common/editor/ui/EditorHelpTooltip.tsx';
import { withinHelpTooltipPointerPath } from '../src/common/editor/ui/help-tooltip-pointer-path.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('help can be hovered across its gap and is dismissed once the pointer leaves its reading path', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<EditorHelpTooltip subject="Recording" description="Keep input devices open."
			helpLabel="Help" hook="recording" />));
		const wrapper = dom.one('.audio-editor-help-wrap');
		const trigger = dom.one('[data-editor-help="recording"]');
		trigger.getBoundingClientRect = () => ({ left: 100, right: 124, top: 100, bottom: 124, width: 24, height: 24 });
		await act(async () => { reactProps(wrapper).onPointerEnter(); });
		const tooltip = dom.one('[role="tooltip"]');
		tooltip.getBoundingClientRect = () => ({ left: 80, right: 380, top: 132, bottom: 200, width: 300, height: 68 });
		await act(async () => { reactProps(wrapper).onPointerLeave({ clientX: 130, clientY: 114 }); });
		assert.ok(dom.find('[role="tooltip"]'), 'the ordinary diagonal path into the text stays readable');
		await act(async () => { reactProps(wrapper).onPointerLeave({ clientX: 450, clientY: 210 }); });
		assert.equal(dom.find('[role="tooltip"]'), null, 'leaving the reading path still dismisses hover help');
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		dom.restore();
	}
});

test('the help pointer corridor works above, below, and across a viewport-clamped explanation', () => {
	const trigger = { left: 100, right: 124, top: 100, bottom: 124 };
	const below = { left: 80, right: 380, top: 132, bottom: 200 };
	assert.equal(withinHelpTooltipPointerPath({ clientX: 130, clientY: 114 }, trigger, below), true);
	assert.equal(withinHelpTooltipPointerPath({ clientX: 370, clientY: 160 }, trigger, below), true);
	assert.equal(withinHelpTooltipPointerPath({ clientX: 370, clientY: 105 }, trigger, below), false);
	assert.equal(withinHelpTooltipPointerPath({ clientX: 130, clientY: 114 }, trigger,
		{ left: 80, right: 380, top: 24, bottom: 92 }), true);
	assert.equal(withinHelpTooltipPointerPath({ clientX: 20, clientY: 128 }, trigger,
		{ left: 10, right: 90, top: 132, bottom: 200 }), false);
});

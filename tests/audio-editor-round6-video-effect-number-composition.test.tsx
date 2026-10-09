/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import VideoEffectNumberInput from '../src/common/editor/ui/inspector/VideoEffectNumberInput.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const key of ['Enter', 'Escape']) {
	test(`video-effect numeric preview releases composing ${key} without ending its gesture`, async () => {
		const dom = installReactTestDom();
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		const root = createRoot(dom.container as unknown as Element);
		let current = 0; let commits = 0; let cancels = 0;
		const render = () => root.render(<VideoEffectNumberInput value={current} minimum={-1} maximum={1}
			step={0.01} label="Brightness" disabled={false} onBegin={() => undefined}
			onPreview={value => { current = value; render(); }} onCommit={() => { commits++; }}
			onCancel={() => { cancels++; current = 0; render(); }} />);
		try {
			await act(async () => { render(); });
			const input = dom.one('input');
			await act(async () => { reactProps(input).onFocus(); });
			await act(async () => { reactProps(input).onChange({ currentTarget: { value: '0.3', valueAsNumber: 0.3 } }); });
			assert.equal(current, 0.3);
			let prevented = false; let stopped = false;
			await act(async () => { reactProps(input).onKeyDown({ key, nativeEvent: { isComposing: true },
				preventDefault() { prevented = true; }, stopPropagation() { stopped = true; },
			}); });
			assert.equal(commits + cancels, 0, 'an input-method key cannot end the preview gesture');
			assert.equal(input.value, '0.3');
			assert.equal(current, 0.3);
			assert.equal(prevented || stopped, false);
			await act(async () => { reactProps(input).onChange({ currentTarget: { value: '0.4', valueAsNumber: 0.4 } }); });
			await act(async () => { reactProps(input).onKeyDown({ key: 'Enter', nativeEvent: { isComposing: false },
				preventDefault() { prevented = true; }, stopPropagation() { stopped = true; },
			}); });
			assert.equal(commits, 1);
			assert.equal(cancels, 0);
			assert.equal(current, 0.4);
			await act(async () => { reactProps(input).onBlur(); });
			assert.equal(commits, 1, 'the final blur does not duplicate the completed commit');
		} finally {
			await act(async () => { root.unmount(); });
			dom.restore(); actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		}
	});
}

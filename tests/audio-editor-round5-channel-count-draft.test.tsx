/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ExportChannelMappingDialog from '../src/common/editor/ui/inspector/ExportChannelMappingDialog.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('the production channel grid retains a cleared count draft and hidden routing columns', async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as HTMLElement);
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	let committed = '';
	try {
		await act(async () => { root.render(<ExportChannelMappingDialog copy={{}} inputChannelCount={2}
			value={null} onCommit={value => { committed = value; }} onClose={() => undefined} />); });
		const field = dom.one('[data-export-channel-mapping-field="outputs"]');
		const input = field.querySelector('input'); assert.ok(input);
		const change = async (value: string): Promise<void> => {
			await act(async () => { reactProps(input).onChange({ target: { value } }); });
		};
		await change('');
		assert.equal(input.value, '', 'clearing does not put the previous count back before typing');
		await change('1'); await change('12');
		await act(async () => { reactProps(field).onBlurCapture({ target: input, relatedTarget: null, currentTarget: field }); });
		assert.equal(input.value, '12');
		const lastCell = dom.one('[data-export-channel-mapping-cell="1-11"]');
		const checkbox = lastCell.querySelector('[role="checkbox"]'); assert.ok(checkbox);
		await act(async () => { reactProps(checkbox).onClick({}); });
		await change('1'); await change('12');
		const retained = dom.one('[data-export-channel-mapping-cell="1-11"]').querySelector('[role="checkbox"]');
		assert.equal(retained?.getAttribute('aria-checked'), 'true', 'retyping a smaller prefix preserves hidden authored routes');
		const apply = dom.one('[data-export-channel-mapping-action="apply"]').querySelector('button'); assert.ok(apply);
		await act(async () => { reactProps(apply).onClick({}); });
		const saved: unknown = JSON.parse(committed);
		assert.ok(saved && typeof saved === 'object' && 'channels' in saved && Array.isArray(saved.channels));
		assert.equal(saved.channels.length, 12);
		assert.deepEqual(saved.channels[11], { inputs: [{ channel: 1, gain: 1 }] });
		await change('');
		await act(async () => { reactProps(field).onBlurCapture({ target: input, relatedTarget: null, currentTarget: field }); });
		assert.equal(input.value, '12', 'an unfinished empty entry restores the last admitted grid on blur');
	} finally {
		await act(async () => { root.unmount(); }); dom.restore(); globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
	}
});

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { StereoChannelDivider } from '../src/common/editor/ui/timeline/StereoChannelDivider.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const buttons of [4, 2]) for (const phase of ['release', 'auxiliary', 'foreign', 'pen', 'touch'] as const) {
	test(`stereo divider preserves ${phase} ownership with buttons ${String(buttons)}`, async () => {
		const dom = installReactTestDom();
		const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
		globals.IS_REACT_ACT_ENVIRONMENT = true;
		const root = createRoot(dom.container as unknown as Element);
		const commits: number[] = [], previews: (number | null)[] = [];
		try {
			await act(async () => root.render(<StereoChannelDivider enabled height={200} ratio={.5} label="Track channels"
				onPreview={value => previews.push(value)} onCommit={value => commits.push(value)} />));
			const surface = dom.one('[data-stereo-channel-divider]');
			Object.assign(dom.one('[data-stereo-channel-divider-root]'), { getBoundingClientRect: () => ({ top: 0, height: 200 }) });
			Object.assign(surface, { setPointerCapture() {}, releasePointerCapture() {} });
			const pointer = (clientY: number, pointerId = 1) => ({ currentTarget: surface, target: surface,
				pointerId, button: 0, buttons: 1, isPrimary: pointerId !== 2, clientY,
				pointerType: phase === 'pen' || phase === 'touch' ? phase : 'mouse', preventDefault() {}, stopPropagation() {} });
			await act(async () => reactProps(surface).onPointerDown(pointer(100)));
			await act(async () => reactProps(surface).onPointerMove(pointer(110)));
			await act(async () => reactProps(surface).onPointerMove({ ...pointer(110, phase === 'foreign' ? 2 : 1),
				button: phase === 'auxiliary' ? 1 : 0, buttons }));
			if (phase !== 'release') {
				assert.deepEqual(commits, [], 'unrelated changes do not finish the divider');
				await act(async () => reactProps(surface).onPointerUp(pointer(110)));
			}
			assert.deepEqual(commits, [.55], 'the owning primary release commits its accepted split');
			assert.equal(previews.at(-1), null, 'completion clears the preview that would obscure keyboard edits');
			await act(async () => reactProps(surface).onPointerMove({ ...pointer(150), button: -1, buttons }));
			await act(async () => reactProps(surface).onPointerUp(pointer(150)));
			assert.deepEqual(commits, [.55]);
			assert.equal(previews.at(-1), null);
			await act(async () => reactProps(surface).onPointerDown(pointer(100, 3)));
			await act(async () => reactProps(surface).onPointerUp(pointer(120, 3)));
			assert.deepEqual(commits, [.55, .6], 'the next ordinary resize remains available');
		} finally {
			await act(async () => root.unmount());
			globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
			dom.restore();
		}
	});
}

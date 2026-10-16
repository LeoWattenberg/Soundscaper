/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { StereoChannelDivider } from '../src/common/editor/ui/timeline/StereoChannelDivider.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

interface KeyInput {
	readonly key: string;
	readonly defaultPrevented?: boolean;
	readonly ctrlKey?: boolean;
	readonly metaKey?: boolean;
	readonly altKey?: boolean;
	readonly shiftKey?: boolean;
}

async function resize(keys: readonly KeyInput[]) {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorReact = globals.React, priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.React = React;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const commits: number[] = [], previews: Array<number | null> = [];
	let prevented = 0, stopped = 0;
	try {
		await act(async () => root.render(<StereoChannelDivider enabled height={100} ratio={0.5}
			label="Stereo channels" onCommit={ratio => commits.push(ratio)} onPreview={ratio => previews.push(ratio)} />));
		const divider = dom.one('[data-stereo-channel-divider]');
		for (const input of keys) await act(async () => reactProps(divider).onKeyDown({ ...input,
			preventDefault() { prevented++; }, stopPropagation() { stopped++; } }));
		return { commits, previews, prevented, stopped };
	} finally {
		await act(async () => root.unmount());
		globals.React = priorReact;
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
}

for (const input of [
	{ key: 'ArrowUp', ctrlKey: true }, { key: 'ArrowDown', altKey: true },
	{ key: 'Home', metaKey: true }, { key: 'End', defaultPrevented: true },
]) test(`the stereo divider leaves ${JSON.stringify(input)} with its keyboard owner`, async () => {
	assert.deepEqual(await resize([input]), { commits: [], previews: [], prevented: 0, stopped: 0 });
});

test('plain and Shift arrows plus Home/End retain the existing bounded resize contract', async () => {
	const result = await resize([{ key: 'ArrowUp' }, { key: 'ArrowDown', shiftKey: true },
		{ key: 'Home' }, { key: 'End' }, { key: 'Enter' }]);
	assert.deepEqual(result, { commits: [0.45, 0.55, 0.2, 0.8], previews: [], prevented: 4, stopped: 4 });
});

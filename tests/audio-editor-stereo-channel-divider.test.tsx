/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';

import { StereoChannelDivider } from '../src/common/editor/ui/timeline/StereoChannelDivider.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

(globalThis as unknown as { React: unknown }).React = React;
const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const priorActEnvironment = actGlobal.IS_REACT_ACT_ENVIRONMENT;
actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
test.after(() => { actGlobal.IS_REACT_ACT_ENVIRONMENT = priorActEnvironment; });

test('the stereo divider is opt-in and exposes its current split accessibly', () => {
	assert.equal(renderToStaticMarkup(<StereoChannelDivider
		enabled={false} height={100} ratio={0.6} label="Stereo channel divider"
		onPreview={() => undefined} onCommit={() => undefined}
	/>), '');
	const markup = renderToStaticMarkup(<StereoChannelDivider
		enabled top={20} height={100} ratio={0.6} label="Stereo channel divider"
		onPreview={() => undefined} onCommit={() => undefined}
	/>);
	assert.match(markup, /role="separator"/u);
	assert.match(markup, /aria-valuenow="60"/u);
	assert.match(markup, /aria-valuemin="20"/u);
	assert.match(markup, /aria-valuemax="80"/u);
	assert.match(markup, /top:20px/u);
	assert.match(markup, /top:60%/u);
	assert.match(markup, /z-index:1002/u);
});

test('pointer dragging previews a bounded ratio and commits only on release', async () => {
	const dom = installReactTestDom();
	const previews: Array<number | null> = [];
	const commits: number[] = [];
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<StereoChannelDivider
			enabled height={100} ratio={0.5} label="Stereo channel divider"
			onPreview={(ratio) => previews.push(ratio)} onCommit={(ratio) => commits.push(ratio)}
		/>));
		const divider = dom.one('[data-stereo-channel-divider]');
		const body = divider.parentNode;
		assert.ok(body && 'getBoundingClientRect' in body);
		Object.defineProperty(body, 'getBoundingClientRect', {
			configurable: true,
			value: () => ({ top: 20, height: 100 }),
		});
		const captured = new Set<number>();
		const currentTarget = {
			setPointerCapture: (pointerId: number) => captured.add(pointerId),
			releasePointerCapture: (pointerId: number) => captured.delete(pointerId),
		};
		const props = reactProps(divider);
		await act(async () => props.onPointerDown({
			button: 0, clientY: -100, pointerId: 4, currentTarget,
			preventDefault() {}, stopPropagation() {},
		}));
		await act(async () => props.onPointerMove({
			clientY: 90, pointerId: 4, currentTarget,
			preventDefault() {}, stopPropagation() {},
		}));
		assert.deepEqual(previews, [0.2, 0.7]);
		assert.deepEqual(commits, []);
		await act(async () => props.onPointerUp({
			clientY: 1_000, pointerId: 4, currentTarget,
			preventDefault() {}, stopPropagation() {},
		}));
		assert.deepEqual(previews, [0.2, 0.7, 0.8, null]);
		assert.deepEqual(commits, [0.8]);
		assert.equal(captured.size, 0);
	} finally {
		await act(async () => root.unmount());
		dom.restore();
	}
});

test('keyboard resizing commits a bounded five-percent step', async () => {
	const dom = installReactTestDom();
	const commits: number[] = [];
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<StereoChannelDivider
			enabled height={100} ratio={0.79} label="Stereo channel divider"
			onPreview={() => undefined} onCommit={(ratio) => commits.push(ratio)}
		/>));
		const props = reactProps(dom.one('[data-stereo-channel-divider]'));
		await act(async () => props.onKeyDown({ key: 'ArrowDown', preventDefault() {}, stopPropagation() {} }));
		await act(async () => props.onKeyDown({ key: 'Home', preventDefault() {}, stopPropagation() {} }));
		assert.deepEqual(commits, [0.8, 0.2]);
	} finally {
		await act(async () => root.unmount());
		dom.restore();
	}
});

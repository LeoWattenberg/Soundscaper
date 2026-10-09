/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SpectralBrushOverlay } from '../src/common/editor/ui/timeline/SpectralBrushOverlay.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const incomingPrimary of [false, true]) {
	void test(`spectral brush keeps the active stroke before a ${incomingPrimary ? 'primary mouse' : 'second touch'}`, async () => {
		const fixture = await mountBrush();
		try {
			await fixture.begin(1, true, 40);
			await fixture.finish(1, 60);
			assert.equal(fixture.commits.length, 1);
			const healthy = fixture.commits[0];
			fixture.commits.length = 0;
			fixture.captures.length = 0;
			await fixture.begin(1, true, 40);
			await fixture.begin(2, incomingPrimary, 80);
			assert.deepEqual(fixture.captures, [1]);
			await fixture.finish(2, 80);
			assert.equal(fixture.commits.length, 0);
			await fixture.finish(1, 60);
			assert.deepEqual(fixture.commits, [healthy]);
		} finally { await fixture.cleanup(); }
	});
}

void test('a nonprimary brush pointer cannot create a fresh stroke', async () => {
	const fixture = await mountBrush();
	try {
		await fixture.begin(2, false, 40);
		await fixture.finish(2, 60);
		assert.equal(fixture.captures.length, 0);
		assert.equal(fixture.commits.length, 0);
	} finally { await fixture.cleanup(); }
});

void test('owning cancellation still discards a brush stroke and permits a fresh stroke', async () => {
	const fixture = await mountBrush();
	try {
		await fixture.begin(1, true, 40);
		await fixture.finish(1, 60, true);
		assert.equal(fixture.commits.length, 0);
		await fixture.begin(3, true, 40);
		await fixture.finish(3, 60);
		assert.equal(fixture.commits.length, 1);
	} finally { await fixture.cleanup(); }
});

async function mountBrush() {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const commits: unknown[] = [];
	const captures: number[] = [];
	await act(async () => root.render(<SpectralBrushOverlay
		track={{ spectrogram: { scale: 'linear', minimumFrequency: 0, maximumFrequency: 24_000 } }}
		displayMode="spectrogram" trackHeight={100} windowWidth={400} overscanStartFrame={0}
		pixelsPerSecond={100} sampleRate={48_000} disabled={false} copy={{ spectralBrush: 'Spectral brush' }}
		onCommit={(value: unknown) => commits.push(value)} />));
	const brush = dom.one('[data-spectral-brush]');
	Object.defineProperty(brush, 'setPointerCapture', { configurable: true, value: (id: number) => captures.push(id) });
	const event = (id: number, x: number, isPrimary = true) => ({ currentTarget: brush,
		pointerId: id, button: 0, isPrimary, clientX: x, clientY: 30, preventDefault() {}, stopPropagation() {} });
	return { commits, captures,
		async begin(id: number, isPrimary: boolean, x: number) {
			await act(async () => { reactProps(brush).onPointerDown?.(event(id, x, isPrimary)); });
		},
		async finish(id: number, x: number, cancel = false) {
			await act(async () => { reactProps(brush)[cancel ? 'onPointerCancel' : 'onPointerUp']?.(event(id, x)); });
		},
		async cleanup() {
			await act(async () => root.unmount());
			globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
			if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		},
	};
}

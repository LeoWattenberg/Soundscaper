/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useRef } from 'react';
import ClipSourceFades from '../src/common/editor/ui/inspector/ClipSourceFades.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

test('source fade portals remain attached after panning away and back to the active clip', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const clip = { id: 'clip', timelineStartFrame: 1_000, durationFrames: 1_000, fadeInFrames: 100 };
	function Subject({ startFrame, endFrame }: { readonly startFrame: number; readonly endFrame: number }) {
		const rootRef = useRef<HTMLDivElement>(null);
		return <div ref={rootRef}><ClipSourceFades rootRef={rootRef} clip={clip} startFrame={startFrame} endFrame={endFrame}
			width={1_000} sampleRate={48_000} blocked={false} copy={ENGLISH_COPY} onChange={() => {}} /></div>;
	}
	try {
		await act(async () => { root.render(<Subject startFrame={1_000} endFrame={2_000} />); });
		assert.ok(dom.find('[data-clip-fade-handle="in"]'));
		assert.equal(dom.one('[data-fade-boundary="in"]').getAttribute('x1'), '100');
		assert.equal(dom.one('[data-fade-boundary="in"]').getAttribute('x2'), '100');
		assert.ok(dom.find('[data-fade-shading]'));
		assert.equal(dom.find('[data-fade-boundary="out"]'), null, 'zero-length fades have no guide');
		await act(async () => { root.render(<Subject startFrame={1_025} endFrame={1_075} />); });
		assert.ok(dom.find('[data-fade-shading]'), 'a cropped fade still shades the visible curve');
		assert.equal(dom.find('[data-fade-boundary="in"]'), null, 'the cropped edge is not a fade endpoint');
		await act(async () => { root.render(<Subject startFrame={0} endFrame={500} />); });
		assert.equal(dom.find('[data-clip-fade-handle="in"]'), null);
		await act(async () => { root.render(<Subject startFrame={1_000} endFrame={2_000} />); });
		assert.ok(dom.find('[data-clip-fade-handle="in"]'));
		assert.ok(dom.find('[data-fade-curve="in"]'));
		assert.ok(dom.find('[data-fade-boundary="in"]'));
	} finally {
		await act(async () => { root.unmount(); });
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});

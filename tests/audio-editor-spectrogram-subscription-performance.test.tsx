/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { installReactTestDom } from './helpers/react-test-dom.ts';
import { useSpectrogramCanvasRevision } from '../src/common/editor/ui/timeline/useSpectrogramCanvasRevision.ts';

void test('ordinary waveform rows receive no FFT invalidations while entering spectrogram reads the latest revision', async () => {
	const dom = installReactTestDom(); const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT; actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const listeners = new Set<(revision: number) => void>(); let revision = 0; let renders = 0; let observed = 0;
	const store = { read: () => revision, subscribe(listener: (value: number) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; } };
	function Harness({ enabled }: { enabled: boolean }) { renders++; observed = useSpectrogramCanvasRevision(enabled, store); return null; }
	const { createRoot } = await import('react-dom/client'); const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<Harness enabled={false} />)); assert.equal(listeners.size, 0);
		const initial = renders; revision = 10;
		await act(async () => { for (const listener of listeners) listener(revision); }); assert.equal(renders, initial);
		await act(async () => root.render(<Harness enabled />)); assert.equal(observed, 10); assert.equal(listeners.size, 1);
		revision = 11; await act(async () => { for (const listener of listeners) listener(revision); }); assert.equal(observed, 11);
		await act(async () => root.render(<Harness enabled={false} />)); assert.equal(listeners.size, 0);
	} finally { await act(async () => root.unmount()); actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct; dom.restore(); }
});

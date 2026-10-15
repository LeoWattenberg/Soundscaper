/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import CompositionBridge, { type MotionLinkBridgeCopy } from '../src/common/editor/ui/composition-link/CompositionBridge.tsx';
import { MOTION_LINK_BRIDGE_COPY_BY_LOCALE } from '../src/common/i18n/editor-motion-link-bridge-copy.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

test('M10 late French bridge copy updates the connected UI without reconnecting or cancelling its owned session', async () => {
	const dom = installReactTestDom(); const root = createRoot(dom.container as unknown as Element);
	const scope = new EventTarget() as unknown as Window;
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	const global = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = global.IS_REACT_ACT_ENVIRONMENT; global.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { value: React, configurable: true });
	const ended = deferred<void>(), loaded = deferred<MotionLinkBridgeCopy>();
	const signals: AbortSignal[] = []; let starts = 0, disposed = 0;
	const open = (signal: AbortSignal) => {
		starts++; signals.push(signal);
		return Promise.resolve({ closed: ended.promise, dispose() { disposed++; ended.resolve(); } });
	};
	const translated: MotionLinkBridgeCopy = { ...MOTION_LINK_BRIDGE_COPY_BY_LOCALE.en,
		title: 'Lien de composition', connected: 'Connecté. Les compositions enregistrées sont transmises.' };
	const render = (copy: MotionLinkBridgeCopy) => root.render(<CompositionBridge scope={scope} role="receive" open={open} copy={copy} />);
	try {
		await act(async () => { render(MOTION_LINK_BRIDGE_COPY_BY_LOCALE.en); });
		assert.equal(starts, 1); assert.equal(disposed, 0); assert.equal(signals[0]!.aborted, false);
		const update = loaded.promise.then(render);
		await act(async () => { loaded.resolve(translated); await update; });
		assert.equal(starts, 1, 'Translation completion must not start a second handshake.');
		assert.equal(disposed, 0, 'Translation completion must not dispose the established session.');
		assert.equal(signals[0]!.aborted, false);
		assert.equal(dom.one('h1').textContent, translated.title);
		assert.equal(dom.one('[role="status"]').textContent, translated.connected);
	} finally {
		await act(async () => { root.unmount(); }); dom.restore(); global.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact); else Reflect.deleteProperty(globalThis, 'React');
	}
	assert.equal(disposed, 1); assert.equal(signals[0]!.aborted, true);
});

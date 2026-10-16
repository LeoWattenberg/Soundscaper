/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import WebVcrPreview from '../src/common/editor/ui/workspace/WebVcrPreview.tsx';
import type { WebVcrCrop, WebVcrUiSnapshot } from '../src/common/editor/ui/web-vcr-ui-model.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const handle of ['move', 'top-left'] as const) {
	test(`${handle} crop keeps the first pointer when a second finger arrives`, async () => {
		await withPreview(async (dom, crops) => {
			const control = dom.one(`.kw-web-vcr__crop-handle--${handle}`);
			const props = reactProps(control);
			const captured: number[] = [];
			const event = (pointerId: number, clientX: number) => ({ pointerId, clientX, clientY: 0, button: 0,
				isPrimary: pointerId === 1, currentTarget: { setPointerCapture(id: number) { captured.push(id); } },
				preventDefault() {} });
			await act(async () => props.onPointerDown!(event(1, 0)));
			await act(async () => props.onPointerMove!(event(1, 10)));
			assert.equal(crops.length, 1, 'ordinary owning-pointer movement publishes a crop');
			await act(async () => props.onPointerDown!(event(2, 10)));
			assert.deepEqual(captured, [1], 'secondary input must not replace the existing capture');
			await act(async () => props.onPointerMove!(event(1, 20)));
			assert.equal(crops.length, 2, 'the original pointer retains authority');
			await act(async () => props.onPointerUp!(event(2, 10)));
			await act(async () => props.onPointerMove!(event(1, 30)));
			assert.equal(crops.length, 3);
			await act(async () => props.onPointerUp!(event(1, 30)));
			await act(async () => props.onPointerMove!(event(1, 40)));
			assert.equal(crops.length, 3, 'completed owning gesture stops publishing');
		});
	});
}

async function withPreview(check: (dom: ReturnType<typeof installReactTestDom>, crops: WebVcrCrop[]) => Promise<void>) {
	const dom = installReactTestDom();
	const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = environment.IS_REACT_ACT_ENVIRONMENT;
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	environment.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const crops: WebVcrCrop[] = [];
	const snapshot: WebVcrUiSnapshot = { capability: { status: 'available', reason: null }, phase: 'ready', modeActive: true,
		navigation: { url: 'https://example.test/', canGoBack: false, canGoForward: false, loading: false, generation: 1 },
		resolution: '1080p', availableResolutions: ['720p', '1080p'], autoCrop: false, aspect: 'free',
		crop: { x: 0.1, y: 0.2, width: 0.6, height: 0.5 }, monitorMuted: false, autoStop: false,
		surface: { width: 1920, height: 1080 }, output: null, intrinsic: null, target: null,
		lowerResolutionWarning: false, error: null };
	try {
		await act(async () => root.render(<WebVcrPreview copy={ENGLISH_COPY} snapshot={snapshot} disabled={false}
			onCrop={crop => { crops.push(crop); }} onPointerInput={() => undefined} onKeyInput={() => undefined}
			onReleaseFocus={() => undefined} />));
		await check(dom, crops);
	} finally {
		await act(async () => root.unmount());
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
		else Reflect.deleteProperty(globalThis, 'React');
		environment.IS_REACT_ACT_ENVIRONMENT = previousAct;
		dom.restore();
	}
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { AssistanceOwnedReframePathV1 } from '../src/common/editor/assistance/owned-video-highlight-transform-types-v1.ts';
import type { LocalAssistanceGuidedReviewedResult } from '../src/common/editor/assistance/local-assistance-guided-result-review.ts';
import LocalAssistanceGuidedReview from '../src/common/editor/ui/dialogs/LocalAssistanceGuidedReview.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const draft = {
	schemaVersion: 1, kind: 'reframe-path', fallbackChain: ['subject', 'saliency', 'center'],
	authority: { width: 1920, height: 1080, timescale: 24, frames: [{ sourceFrame: 0, presentationTick: '0' }] },
	path: { schemaVersion: 1, targetAspect: { width: 9, height: 16 }, keyframes: [{
		sourceFrame: 0, authority: 'center', trackIds: [],
		crop: { left: 0.3734375, top: 0.1, right: 0.3734375, bottom: 0.1 },
	}] },
} as const satisfies AssistanceOwnedReframePathV1;
const review = {
	reviewVersion: 1, jobId: 'job', workflowId: 'reframe', outputs: [], choices: [],
} as const satisfies LocalAssistanceGuidedReviewedResult;

test('Guided crop retains one contact until release, then admits a fresh gesture', async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as Element);
	const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = environment.IS_REACT_ACT_ENVIRONMENT;
	environment.IS_REACT_ACT_ENVIRONMENT = true;
	const edits: unknown[] = [];
	const captures = new Set<number>();
	try {
		await act(async () => root.render(<LocalAssistanceGuidedReview copy={{}} review={review}
			selectedChoiceIds={[]} onChoiceChange={() => undefined} reframeDraft={draft}
			onReframeCropChange={(sourceFrame, crop) => { edits.push({ sourceFrame, crop }); }} />));
		const overlay = dom.one('.kw-local-assistance__crop-overlay');
		Object.defineProperties(overlay, {
			getBoundingClientRect: { value: () => ({ left: 0, top: 0, width: 200, height: 100 }) },
			setPointerCapture: { value: (id: number) => captures.add(id) },
			hasPointerCapture: { value: (id: number) => captures.has(id) },
			releasePointerCapture: { value: (id: number) => captures.delete(id) },
		});
		const point = (pointerId: number, clientX: number) => ({
			button: 0, pointerId, clientX, clientY: 50, currentTarget: overlay,
		});
		await act(async () => reactProps(overlay).onPointerDown(point(1, 100)));
		await act(async () => reactProps(overlay).onPointerMove(point(1, 120)));
		assert.equal(edits.length, 2, 'the ordinary first contact moves the crop');
		const authored = edits.at(-1);
		await act(async () => reactProps(overlay).onPointerDown(point(2, 50)));
		assert.equal(edits.length, 2, 'another finger cannot replace the crop while the first is held');
		assert.deepEqual([...captures], [1]);
		await act(async () => reactProps(overlay).onPointerUp(point(2, 50)));
		await act(async () => reactProps(overlay).onPointerMove(point(1, 130)));
		assert.notDeepEqual(edits.at(-1), authored, 'releasing another finger leaves the first contact active');
		await act(async () => reactProps(overlay).onPointerUp(point(1, 130)));
		await act(async () => reactProps(overlay).onPointerDown(point(3, 140)));
		assert.deepEqual([...captures], [3], 'completion releases admission for a fresh contact');
		await act(async () => reactProps(overlay).onPointerCancel(point(3, 140)));
		await act(async () => reactProps(overlay).onPointerDown(point(4, 150)));
		assert.deepEqual([...captures], [4], 'native cancellation releases the contact');
		captures.delete(4);
		await act(async () => reactProps(overlay).onLostPointerCapture(point(4, 150)));
		await act(async () => reactProps(overlay).onPointerDown(point(5, 160)));
		assert.deepEqual([...captures], [5], 'lost capture also releases the contact');
	} finally {
		await act(async () => root.unmount());
		environment.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

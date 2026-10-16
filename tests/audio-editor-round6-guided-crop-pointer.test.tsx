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

for (const button of [0, 1, 2]) test(`Guided crop reserves editing for primary pointer ${button}`, async () => {
	const dom = installReactTestDom();
	const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = environment.IS_REACT_ACT_ENVIRONMENT;
	environment.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const edits: unknown[] = [];
	let captures = 0;
	try {
		await act(async () => root.render(<LocalAssistanceGuidedReview copy={{}} review={review}
			selectedChoiceIds={[]} onChoiceChange={() => undefined} reframeDraft={draft}
			onReframeCropChange={(sourceFrame, crop) => { edits.push({ sourceFrame, crop }); }} />));
		const overlay = dom.one('.kw-local-assistance__crop-overlay');
		Object.defineProperties(overlay, {
			getBoundingClientRect: { value: () => ({ left: 0, top: 0, width: 200, height: 100 }) },
			setPointerCapture: { value: () => { captures++; } },
		});
		await act(async () => reactProps(overlay).onPointerDown({
			button, pointerId: 3, clientX: 150, clientY: 50, currentTarget: overlay,
		}));
		assert.equal(captures, button === 0 ? 1 : 0);
		assert.equal(edits.length, button === 0 ? 1 : 0);
		if (button === 0) assert.deepEqual(edits, [{ sourceFrame: 0,
			crop: { left: 0.6234375, top: 0.1, right: 0.1234375, bottom: 0.1 } }]);
	} finally {
		await act(async () => root.unmount());
		environment.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

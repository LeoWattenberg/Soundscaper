/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionAnalysisControls } from '../src/common/editor/ui/dialogs/FramescaperFinishingPanels.tsx';
import { motionSourceFrameClock } from '../src/common/editor/ui/dialogs/MotionSourceFrameTimeCodeField.tsx';
import { createVideoTimingAssetPublication, validateVideoTimingAssetBytes } from '../src/common/editor/video-timing-asset.ts';
import { registerVideoTimingIndex, unregisterVideoTimingIndex } from '../src/common/editor/video-source-time.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('the mounted motion range reads native source frames at the source rate', async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as HTMLElement);
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const observer = Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver');
	Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: class {
		observe() {} disconnect() {}
	} });
	const source = { id: 'camera', kind: 'video', frameRate: { num: 15, den: 1 }, sourceFrameCount: 32,
		timingDecision: { mode: 'conform-cfr-at-ingest', rate: { num: 15, den: 1 } } };
	const target = { stackId: 'tracking', sourceId: source.id, sourceName: 'camera.webm',
		startFrame: 0, endFrame: 32, analysisId: 'analysis', freshness: 'missing' as const };
	const props = { source, frameRate: 30, blocked: false, targets: [target], target,
		stackId: target.stackId, startFrame: 0, endFrame: 15, progress: null, pending: false,
		copy: {}, onStack() {}, onStartFrame() {}, onEndFrame() {}, onAnalyze() {}, onCancel() {} };
	try {
		await act(async () => { root.render(<MotionAnalysisControls {...props} />); });
		const end = dom.container.querySelectorAll('.timecode__display')[1];
		assert.ok(end);
		assert.equal(end.querySelectorAll('.timecode-digit').map(digit => digit.textContent).join(''), '00000100');
		const trigger = dom.container.querySelectorAll('.timecode__format-button')[1];
		assert.ok(trigger);
		await act(async () => { reactProps(trigger).onClick?.({ detail: 1 }); });
		const secondsFormat = dom.container.querySelectorAll('[role="menuitem"]')
			.find(item => item.textContent === 'seconds + milliseconds');
		assert.ok(secondsFormat);
		await act(async () => { reactProps(secondsFormat).onClick?.({}); });
		assert.equal(end.textContent, '000,001.000s');
	} finally {
		await act(async () => { root.unmount(); });
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previous;
		if (observer) Object.defineProperty(globalThis, 'MutationObserver', observer);
		else Reflect.deleteProperty(globalThis, 'MutationObserver');
		dom.restore();
	}
});

test('motion source time resolves CFR boundaries and the exclusive end without sequence conversion', () => {
	const clock = motionSourceFrameClock({ id: 'camera', kind: 'video', frameRate: { num: 15, den: 1 },
		sourceFrameCount: 32, timingDecision: { mode: 'conform-cfr-at-ingest', rate: { num: 15, den: 1 } } });
	assert.equal(clock.rate, 15);
	assert.equal(clock.secondsAt(15), 1);
	assert.equal(clock.frameAt(1), 15);
	assert.equal(clock.frameAt(clock.secondsAt(32)), 32);
	assert.equal(clock.frameAt(100), 32);
	assert.equal(clock.frameAt(-1), 0);
	assert.throws(() => clock.frameAt(Number.NaN), /finite/u);
});

test('motion timestamps retain authenticated variable source boundaries instead of an average rate', () => {
	const digest = '71'.repeat(32);
	const publication = createVideoTimingAssetPublication(digest, { timescale: 1_000,
		presentationTicks: [0n, 40n, 105n], finalFrameDurationTicks: 55n });
	const source = { id: 'vfr-camera', kind: 'video', contentSha256: digest,
		frameRate: { num: 25, den: 1 }, sourceFrameCount: 3,
		timingDecision: { mode: 'exact', rate: { num: 25, den: 1 } }, timingAsset: publication.reference };
	registerVideoTimingIndex(source, validateVideoTimingAssetBytes(publication.reference, publication.bytes));
	try {
		const clock = motionSourceFrameClock(source);
		assert.equal(clock.secondsAt(2), 0.105);
		assert.equal(clock.frameAt(0.105), 2);
		assert.equal(clock.frameAt(0.09), 2);
		assert.equal(clock.secondsAt(3), 0.16);
		assert.equal(clock.frameAt(0.16), 3);
	} finally { unregisterVideoTimingIndex(source); }
});

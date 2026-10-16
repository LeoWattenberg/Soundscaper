/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import ClipSourceRuler, { INITIAL_SOURCE_RULER_OPTIONS } from '../src/common/editor/ui/inspector/ClipSourceRuler.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('source ruler leaves modified seek commands available and retains plain and Shift seeking', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const positions: number[] = [];
	try {
		await act(async () => root.render(<ClipSourceRuler copy={{ clipSourceTimeline: 'Source timeline' }} width={600}
			sampleRate={48_000} startFrame={0} endFrame={38_400} clipStartFrame={0} projectStartFrame={0}
			tempoMap={{ mode: 'musical', events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }] }}
			options={INITIAL_SOURCE_RULER_OPTIONS} onOptions={() => {}} playing={false} positionFrame={19_200}
			onSeekFrame={frame => positions.push(frame)} loop={false} loopRange={null} selection={null} disabled={false}
			onPlay={() => {}} onStop={() => {}} onLoop={() => {}} onClearLoop={() => {}} onLoopSelection={() => {}}
			onSelectionLoop={() => {}} onSeek={() => {}} />));
		const ruler = dom.one('[role="slider"]');
		for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) {
			for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'defaultPrevented']) {
				let prevented = false;
				let stopped = false;
				await act(async () => reactProps(ruler).onKeyDown?.({ key, currentTarget: ruler, [modifier]: true,
					preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } }));
				assert.equal(prevented, false, `${key} with ${modifier} must remain available`);
				assert.equal(stopped, false);
			}
		}
		assert.deepEqual(positions, []);
		for (const [key, shiftKey] of [['Home', false], ['End', false], ['ArrowLeft', false], ['ArrowRight', true]] as const) {
			let prevented = false;
			await act(async () => reactProps(ruler).onKeyDown?.({ key, shiftKey, currentTarget: ruler,
				preventDefault() { prevented = true; }, stopPropagation() {} }));
			assert.equal(prevented, true);
		}
		assert.deepEqual(positions, [0, 38_400, 14_400, 38_400]);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		dom.restore();
	}
});

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import VideoKeyframeDialog from '../src/common/editor/ui/inspector/VideoKeyframeDialog.tsx';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../src/common/editor/video-clip-composition.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { installReactTestDom, type ReactTestElement } from './helpers/react-test-dom.ts';

for (const target of ['scale', 'rotation', 'integer'] as const) {
	test(`native ${target} keyframe fields admit the target's exact supported numbers`, async () => {
		const dom = installReactTestDom();
		const root = createRoot(dom.container as unknown as HTMLElement);
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		try {
			await act(async () => { root.render(<VideoKeyframeDialog productId="framescaper" capability
				controller={{ actions: { edit: { commit: () => undefined } } }}
				snapshot={{ project: project(target), selectedClipId: 'video' }} copy={{}}
				run={operation => operation()} onClose={() => undefined} />); });
			for (const name of ['start-value', 'end-value', 'anchor-value']) {
				const input = dom.one(`[data-video-keyframe-field="${name}"]`);
				assert.equal(nativeNumberAdmits(input, target === 'integer' ? 16 : 1.234), true, name);
				assert.equal(nativeNumberAdmits(input, Number(input.getAttribute('max')) + 1), false, `${name} maximum`);
				if (target === 'integer') assert.equal(nativeNumberAdmits(input, 16.5), false, `${name} integer admission`);
			}
		} finally {
			await act(async () => { root.unmount(); });
			dom.restore(); actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		}
	});
}

/** The browser's number-input range and step constraints, read from the mounted production fields. */
function nativeNumberAdmits(input: ReactTestElement, value: number): boolean {
	const minimum = Number(input.getAttribute('min'));
	const maximum = Number(input.getAttribute('max'));
	if (value < minimum || value > maximum) return false;
	const step = input.getAttribute('step') ?? '1';
	if (step === 'any') return true;
	const units = (value - minimum) / Number(step);
	return Math.abs(units - Math.round(units)) < 1e-7;
}

function project(target: 'scale' | 'rotation' | 'integer') {
	const effect = createVideoEffect('pixelate', { id: 'pixelate' });
	return { schemaFamily: 'framescaper', schemaVersion: 1,
		clips: [{ id: 'video', kind: 'video', title: 'Picture', sequenceStartFrame: 0, sequenceFrameCount: 20,
			videoComposition: DEFAULT_VIDEO_CLIP_COMPOSITION, videoEffects: [effect],
			videoKeyframes: { schemaVersion: 1, timeDomain: { authoredDuration: { num: 20, den: 1 },
				viewStart: { num: 0, den: 1 }, viewDuration: { num: 20, den: 1 } }, curves: [{
				target: target === 'integer' ? { kind: 'video-effect', effectId: 'pixelate', parameterId: 'blockSize' }
					: { kind: 'composition', parameterId: target === 'scale' ? 'transform.scaleX' : 'transform.rotationDegrees' },
				curve: { anchors: [{ position: { num: 0, den: 1 }, value: target === 'integer' ? 16 : 1 },
					{ position: { num: 20, den: 1 }, value: target === 'integer' ? 32 : 2 }],
					segments: [{ kind: target === 'integer' ? 'hold' : 'linear' }] },
			}] } }], tracks: [{ id: 'track', type: 'video', locked: false, clipIds: ['video'] }],
		selection: { clipIds: ['video'] } };
}

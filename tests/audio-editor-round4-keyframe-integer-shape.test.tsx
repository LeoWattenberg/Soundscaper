/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import VideoKeyframeDialog from '../src/common/editor/ui/inspector/VideoKeyframeDialog.tsx';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../src/common/editor/video-clip-composition.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const existing of [false, true]) {
	test(`integer keyframe ${existing ? 'reopening' : 'target selection'} offers and seeds only supported Hold segments`, async () => {
		const dom = installReactTestDom();
		const root = createRoot(dom.container as unknown as HTMLElement);
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		const commands: unknown[] = [];
		try {
			await act(async () => { root.render(<VideoKeyframeDialog productId="framescaper" capability
				controller={{ actions: { edit: { commit: command => { commands.push(command); } } } }}
				snapshot={{ project: project(existing), selectedClipId: 'video' }} copy={{}}
				run={operation => operation()} onClose={() => undefined} />); });
			if (!existing) await act(async () => {
				reactProps(dom.one('[data-video-keyframe-field="target"]')).onChange?.({
					currentTarget: { value: JSON.stringify(['video-effect', 'pixelate', 'blockSize']) },
				});
			});
			const addInterpolation = dom.one('[data-video-keyframe-field="interpolation"]');
			assert.equal(reactProps(addInterpolation).value, 'hold');
			assert.deepEqual(addInterpolation.querySelectorAll('option').map(option => option.getAttribute('value')), ['hold']);
			if (existing) {
				const editInterpolation = dom.one('[data-video-keyframe-field="segment-kind"]');
				assert.equal(reactProps(editInterpolation).value, 'hold');
				assert.deepEqual(editInterpolation.querySelectorAll('option').map(option => option.getAttribute('value')), ['hold']);
			} else {
				await act(async () => { reactProps(dom.one('[data-video-keyframe-field="end-value"]')).onChange?.({ currentTarget: { value: '32' } }); });
				await act(async () => { reactProps(addInterpolation.closest('form')!).onSubmit?.({ preventDefault() {} }); });
				assert.partialDeepStrictEqual(commands, [{ type: 'video-keyframes/set', keyframes: { curves: [{
					target: { kind: 'video-effect', effectId: 'pixelate', parameterId: 'blockSize' },
					curve: { anchors: [{ value: 16 }, { value: 32 }], segments: [{ kind: 'hold' }] },
				}] } }]);
			}
		} finally {
			await act(async () => { root.unmount(); });
			dom.restore(); actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		}
	});
}

test('integer interior anchor removal uses the supported Hold bridge', async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as HTMLElement);
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const commands: unknown[] = [];
	try {
		await act(async () => { root.render(<VideoKeyframeDialog productId="framescaper" capability
			controller={{ actions: { edit: { commit: command => { commands.push(command); } } } }}
			snapshot={{ project: project(true, true), selectedClipId: 'video' }} copy={{}}
			run={operation => operation()} onClose={() => undefined} />); });
		await act(async () => { reactProps(dom.one('[data-video-keyframe-field="anchor"]')).onChange?.({ currentTarget: { value: '1' } }); });
		const remove = dom.container.querySelectorAll('button').find(button => button.textContent === 'Remove anchor');
		assert.ok(remove);
		await act(async () => { reactProps(remove).onClick?.(); });
		assert.partialDeepStrictEqual(commands, [{ type: 'video-keyframes/set', keyframes: { curves: [{
			curve: { anchors: [{ value: 16 }, { value: 32 }], segments: [{ kind: 'hold' }] },
		}] } }]);
	} finally {
		await act(async () => { root.unmount(); });
		dom.restore(); actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
	}
});

function project(existing: boolean, middle = false) {
	return { schemaFamily: 'framescaper', schemaVersion: 1,
		clips: [{ id: 'video', kind: 'video', title: 'Picture', sequenceStartFrame: 0, sequenceFrameCount: 20,
			videoComposition: DEFAULT_VIDEO_CLIP_COMPOSITION, videoEffects: [createVideoEffect('pixelate', { id: 'pixelate' })],
			videoKeyframes: { schemaVersion: 1, timeDomain: { authoredDuration: { num: 20, den: 1 },
				viewStart: { num: 0, den: 1 }, viewDuration: { num: 20, den: 1 } }, curves: existing ? [{
				target: { kind: 'video-effect', effectId: 'pixelate', parameterId: 'blockSize' },
				curve: { anchors: [{ position: { num: 0, den: 1 }, value: 16 },
					...(middle ? [{ position: { num: 10, den: 1 }, value: 24 }] : []),
					{ position: { num: 20, den: 1 }, value: 32 }], segments: middle ? [{ kind: 'hold' }, { kind: 'hold' }] : [{ kind: 'hold' }] },
			}] : [] } }], tracks: [{ id: 'track', type: 'video', locked: false, clipIds: ['video'] }],
		selection: { clipIds: ['video'] } };
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import VideoKeyframeDialog from '../src/common/editor/ui/inspector/VideoKeyframeDialog.tsx';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../src/common/editor/video-clip-composition.ts';
import { deferred } from './helpers/async-test-control.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const count of [1, 2]) test(`removing a keyframe curve restores focus to ${count === 1 ? 'Add curve' : 'the surviving removal action'}`, async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const completion = deferred<unknown>();
	const controller = { actions: { edit: { commit: () => completion.promise } } };
	const original = project(count);
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const render = (removed: boolean) => <VideoKeyframeDialog productId="framescaper" capability
		controller={controller} snapshot={{ project: removed ? { ...original, clips: original.clips.map((clip) => ({
			...clip, videoKeyframes: { ...clip.videoKeyframes, curves: clip.videoKeyframes.curves.slice(1) },
		})) } : original, selectedClipId: 'video' }} copy={{}} run={(operation) => operation()}
		onClose={() => undefined} />;
	const button = (text: string) => {
		const candidate = dom.container.querySelectorAll('button').find((node) => node.textContent === text);
		assert.ok(candidate, text);
		return candidate;
	};
	try {
		await act(async () => { root.render(render(false)); });
		const removed = button('Remove curve');
		removed.focus();
		await act(async () => { reactProps(removed).onClick({ currentTarget: removed }); });
		await act(async () => { root.render(render(true)); });
		document.body.focus();
		await act(async () => { completion.resolve(undefined); await completion.promise; });
		const expected = count === 1 ? button('Add curve') : button('Remove curve');
		assert.equal(document.activeElement, expected);
		if (count === 1) assert.equal(removed.isConnected, false);
	} finally {
		completion.resolve(undefined);
		await act(async () => { root.unmount(); });
		dom.restore();
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
	}
});

function project(count: number) {
	return { schemaFamily: 'framescaper', schemaVersion: 1,
		clips: [{ id: 'video', kind: 'video', title: 'Picture', sequenceStartFrame: 0, sequenceFrameCount: 20,
			videoComposition: DEFAULT_VIDEO_CLIP_COMPOSITION, videoEffects: [],
			videoKeyframes: { schemaVersion: 1, timeDomain: { authoredDuration: { num: 20, den: 1 },
				viewStart: { num: 0, den: 1 }, viewDuration: { num: 20, den: 1 } },
				curves: ['opacity', 'transform.scaleX'].slice(0, count).map((parameterId) => ({
					target: { kind: 'composition', parameterId }, curve: { anchors: [
						{ position: { num: 0, den: 1 }, value: 0.5 },
						{ position: { num: 20, den: 1 }, value: 0.75 },
					], segments: [{ kind: 'linear' }] },
				})),
			} }], tracks: [{ id: 'track', type: 'video', locked: false, clipIds: ['video'] }],
		selection: { clipIds: ['video'] } };
}

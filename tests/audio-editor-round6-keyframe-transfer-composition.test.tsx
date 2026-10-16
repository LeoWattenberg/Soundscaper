/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import VideoKeyframeDialog from '../src/common/editor/ui/inspector/VideoKeyframeDialog.tsx';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../src/common/editor/video-clip-composition.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const project = {
	schemaFamily: 'framescaper', schemaVersion: 1,
	clips: [{ id: 'video', kind: 'video', title: 'Picture', sequenceStartFrame: 0, sequenceFrameCount: 20,
		videoComposition: DEFAULT_VIDEO_CLIP_COMPOSITION, videoEffects: [],
		videoKeyframes: { schemaVersion: 1, timeDomain: { authoredDuration: { num: 20, den: 1 },
			viewStart: { num: 0, den: 1 }, viewDuration: { num: 20, den: 1 } }, curves: [{
			target: { kind: 'composition', parameterId: 'opacity' },
			curve: { anchors: [{ position: { num: 0, den: 1 }, value: 0.5 },
				{ position: { num: 20, den: 1 }, value: 1 }], segments: [{ kind: 'linear' }] },
		}] } }], tracks: [{ id: 'track', type: 'video', locked: false, clipIds: ['video'] }],
	selection: { clipIds: ['video'] },
};

for (const composing of [false, true]) test(`curve Copy shortcut ${composing ? 'releases composition' : 'keeps completed copying'}`, async () => {
	const dom = installReactTestDom();
	const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = environment.IS_REACT_ACT_ENVIRONMENT;
	environment.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<VideoKeyframeDialog productId="framescaper" capability
			controller={{ actions: { edit: { commit() {} } } }}
			snapshot={{ project, selectedClipId: 'video' }} copy={{}}
			run={operation => operation()} onClose={() => undefined} />));
		const transfer = dom.one('[data-video-keyframe-field="transfer"]');
		await act(async () => reactProps(transfer).onChange({ currentTarget: { value: 'とう' } }));
		const fieldset = transfer.closest('fieldset');
		assert.ok(fieldset);
		let prevented = false;
		await act(async () => reactProps(fieldset).onKeyDown({ key: 'c', ctrlKey: true,
			shiftKey: true, altKey: false, metaKey: false, nativeEvent: { isComposing: composing },
			preventDefault() { prevented = true; },
		}));
		const value = String(reactProps(transfer).value);
		assert.equal(prevented, !composing);
		if (composing) assert.equal(value, 'とう');
		else { assert.notEqual(value, 'とう'); assert.doesNotThrow(() => JSON.parse(value) as unknown); }
	} finally {
		await act(async () => root.unmount());
		environment.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

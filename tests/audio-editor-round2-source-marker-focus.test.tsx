/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import ClipSourceEditor from '../src/common/editor/ui/inspector/ClipSourceEditor.tsx';
import type { ClipSourceController, ClipSourceProject } from '../src/common/editor/ui/inspector/clip-source-editor-types.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('source-marker deletion focuses its waveform after publishing the replacement warp map', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let project: ClipSourceProject = {
		id: 'project', sampleRate: 48_000,
		tempoMap: { mode: 'musical', events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }] },
		sources: [{ id: 'source', sampleRate: 48_000, channelCount: 1, frameCount: 100 }],
		clips: [{ id: 'clip', sourceId: 'source', kind: 'audio', anchor: 'sample', reversed: false,
			timelineStartFrame: 0, durationFrames: 100, sourceStartFrame: 0, sourceDurationFrames: 100,
			warpMap: { feature: 'audio-warp', points: [
				{ outer: 0, source: 0, mode: 'forward' }, { outer: 50, source: 50, mode: 'forward' },
				{ outer: 100, source: 100, mode: 'forward' },
			] } }],
	};
	const render = () => root.render(<ClipSourceEditor controller={controller} project={project}
		clipId="clip" copy={{ clipSourceStretchMarker: 'Stretch marker' }} blocked={false} />);
	const controller: ClipSourceController = { getClipVisualData: () => null, actions: {
		clip: { update() {} }, timeline: {}, effects: { setSourceSelection() {} },
		audioWarp: { addSourceMarker() {}, moveSourceMarker() {}, deleteSourceMarker() {
			project = { ...project, clips: [{ ...project.clips[0]!, warpMap: null }] };
			render();
		} },
		clipSourcePreview: { focus() {}, blur() {}, playPause() {}, stop() {}, seek() {},
			setLoop() {}, setLoopRange() {}, setSelection() {}, trim() {}, subscribe: () => () => {},
			snapshot: () => ({ clipId: null, focused: false, state: 'stopped', positionFrame: 0,
				loop: false, loopRange: null }) },
	} };
	try {
		await act(async () => render());
		const marker = dom.one('[data-source-sample="50"]');
		marker.focus();
		await act(async () => reactProps(marker).onKeyDown?.({ key: 'Delete', currentTarget: marker,
			preventDefault() {}, stopPropagation() {} }));
		assert.equal(dom.find('[data-source-sample="50"]'), null);
		assert.equal(dom.container.ownerDocument.activeElement, dom.one('.audio-editor-source-wave-area'));
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		dom.restore();
	}
});

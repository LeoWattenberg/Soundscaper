/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import ClipSourceEditor from '../src/common/editor/ui/inspector/ClipSourceEditor.tsx';
import type { ClipSourceController, ClipSourceProject } from '../src/common/editor/ui/inspector/clip-source-editor-types.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('source trim and stretch controls leave modified commands available and preserve owned navigation', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const project: ClipSourceProject = {
		id: 'project', sampleRate: 48_000,
		tempoMap: { mode: 'musical', events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }] },
		sources: [{ id: 'source', sampleRate: 48_000, channelCount: 1, frameCount: 38_400 }],
		clips: [{ id: 'clip', sourceId: 'source', kind: 'audio', anchor: 'sample', reversed: false,
			timelineStartFrame: 0, durationFrames: 38_400, sourceStartFrame: 0, sourceDurationFrames: 38_400,
			warpMap: { feature: 'audio-warp', points: [
				{ outer: 0, source: 0, mode: 'forward' }, { outer: 19_200, source: 19_200, mode: 'forward' },
				{ outer: 38_400, source: 38_400, mode: 'forward' },
			] } }],
	};
	const trims: Readonly<Record<string, number>>[] = [];
	const moves: number[] = [];
	let deletions = 0;
	const controller: ClipSourceController = { getClipVisualData: () => null, actions: {
		clip: { update() {} }, timeline: {}, effects: { setSourceSelection() {} },
		audioWarp: { addSourceMarker() {}, moveSourceMarker(_id, _index, frame) { moves.push(frame); },
			deleteSourceMarker() { deletions += 1; } },
		clipSourcePreview: { focus() {}, blur() {}, playPause() {}, stop() {}, seek() {},
			setLoop() {}, setLoopRange() {}, setSelection() {}, trim(_id, changes) { trims.push(changes); }, subscribe: () => () => {},
			snapshot: () => ({ clipId: null, focused: false, state: 'stopped', positionFrame: 0,
				loop: false, loopRange: null }) },
	} };
	try {
		await act(async () => root.render(<ClipSourceEditor controller={controller} project={project} clipId="clip"
			copy={{ clipSourceTrimStart: 'Trim source start', clipSourceTrimEnd: 'Trim source end' }} blocked={false} />));
		const controls = [dom.one('[aria-label="Trim source start"]'), dom.one('[aria-label="Trim source end"]'),
			dom.one('[data-source-sample="19200"]')];
		for (const control of controls) {
			for (const key of ['ArrowLeft', 'ArrowRight', 'Delete', 'Backspace']) {
				for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'defaultPrevented']) {
					let prevented = false;
					let stopped = false;
					await act(async () => reactProps(control).onKeyDown?.({ key, currentTarget: control, [modifier]: true,
						preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } }));
					assert.equal(prevented, false, `${key} with ${modifier} must remain available`);
					assert.equal(stopped, false);
				}
			}
		}
		assert.equal(trims.length, 0);
		assert.equal(moves.length, 0);
		assert.equal(deletions, 0);
		for (const [index, control] of controls.entries()) {
			let prevented = false;
			await act(async () => reactProps(control).onKeyDown?.({ key: 'ArrowRight', currentTarget: control,
				shiftKey: index === 1, preventDefault() { prevented = true; }, stopPropagation() {} }));
			assert.equal(prevented, true);
		}
		assert.equal(trims.length, 2);
		assert.equal(trims[0]?.sourceStartFrame, 1);
		assert.deepEqual(moves, [19_201]);
		assert.equal(deletions, 0);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		dom.restore();
	}
});

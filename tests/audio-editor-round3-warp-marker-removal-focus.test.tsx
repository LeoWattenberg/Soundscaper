/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import AudioWarpDialog from '../src/common/editor/ui/dialogs/AudioWarpDialog.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { deferred } from './helpers/async-test-control.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const count of [1, 2]) test(`removing warp marker ${count} hands focus to the surviving marker action or Add marker`, async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const removal = deferred<unknown>();
	const calls: number[] = [];
	const controller = { actions: { audioWarp: {
		view: () => ({ renderStatus: { path: 'exact-offline' as const } }),
		analyze() {}, createIdentityMap() {}, addMarker() { calls.push(0); }, moveMarker() {},
		deleteMarker(index: number) { calls.push(index); return removal.promise; },
		quantize() {}, applyGroove() {}, clear() {},
	} } };
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const render = (points: number, id = 'warp') => <AudioWarpDialog productId="soundscaper"
		controller={controller} snapshot={{ project: project(points, id), selectedClipId: 'clip' }}
		copy={ENGLISH_COPY} run={(operation) => operation()} onClose={() => undefined} />;
	const button = (text: string) => {
		const node = dom.container.querySelectorAll('button').find((candidate) => candidate.textContent === text);
		assert.ok(node, text);
		return node;
	};
	try {
		await act(async () => { root.render(render(count)); });
		const removed = button(`Delete marker ${count}`);
		removed.focus();
		await act(async () => { reactProps(removed).onClick(); });
		assert.deepEqual(calls, [count]);
		await act(async () => { root.render(render(count - 1)); });
		document.body.focus();
		await act(async () => { removal.resolve(undefined); await removal.promise; });
		const replacement = button(count === 1 ? 'Add marker' : 'Delete marker 1');
		assert.equal(document.activeElement, replacement);
		assert.equal(removed.isConnected, false);
		if (count === 1) {
			await act(async () => { reactProps(replacement).onClick(); });
			assert.deepEqual(calls, [1, 0], 'a subsequent keyboard activation can add again');
		}
	} finally {
		removal.resolve(undefined);
		await act(async () => { root.unmount(); });
		dom.restore();
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
	}
});

function project(interiorCount: number, id: string) {
	const source = createAudioSource({ id: 'source', storageKey: 'source', name: 'Recording',
		frameCount: 200, channelCount: 1, sampleRate: 48_000 });
	const clip = createAudioClip({ id: 'clip', sourceId: 'source', title: 'Recording',
		timelineStartFrame: 0, durationFrames: 200, sourceStartFrame: 0, sourceDurationFrames: 200,
		warpMap: { feature: 'audio-warp', points: [
			{ outer: 0, source: 0, mode: 'forward' },
			...Array.from({ length: interiorCount }, (_, index) => ({
				outer: (index + 1) * 50, source: (index + 1) * 50, mode: 'forward' as const,
			})),
			{ outer: 200, source: 200, mode: 'forward' },
		] } });
	return createSoundscaperProject({ id, title: id, now: '2026-10-07T00:00:00.000Z',
		sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'track', name: 'Track', clipIds: ['clip'] })] });
}

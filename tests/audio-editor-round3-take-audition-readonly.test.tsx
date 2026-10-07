/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import TakeCompDialog from '../src/common/editor/ui/dialogs/TakeCompDialog.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('read-only take audition keeps authoring, busy work, and locked tracks blocked', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const calls: string[] = [];
	let finish = (): void => undefined;
	const audition = new Promise<void>((resolve) => { finish = resolve; });
	const controller = { actions: { takeComp: {
		auditionTake: () => { calls.push('take'); },
		auditionLane: () => { calls.push('lane'); return audition; }, stopAudition() {},
		promoteTake: () => { calls.push('promote'); }, editCompBoundary() {}, editSharedCompBoundary() {},
		flatten() {}, removeGroup() {},
	} } };
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const render = (locked = false, recording = false) => <TakeCompDialog productId="soundscaper"
		controller={controller} snapshot={{ project: project(locked), readOnly: true, recording }}
		copy={ENGLISH_COPY} run={(operation) => operation()} onClose={() => undefined} />;
	const button = (text: string) => {
		const node = dom.container.querySelectorAll('button').find((candidate) => candidate.textContent === text);
		assert.ok(node, text);
		return node;
	};
	try {
		await act(async () => { root.render(render()); });
		assert.equal(reactProps(button(ENGLISH_COPY.takeCompAuditionLane)).disabled, false);
		assert.equal(reactProps(button('Audition Take A')).disabled, false);
		await act(async () => { reactProps(button(ENGLISH_COPY.takeCompPromoteAll)).onClick(); });
		assert.deepEqual(calls, [], 'the read-only mutation is refused by the operation owner');
		await act(async () => { reactProps(button(ENGLISH_COPY.takeCompAuditionLane)).onClick(); });
		assert.deepEqual(calls, ['lane']);
		assert.equal(reactProps(button(ENGLISH_COPY.takeCompAuditionLane)).disabled, true, 'pending audition owns its controls');
		await act(async () => { finish(); await audition; });
		assert.equal(reactProps(button(ENGLISH_COPY.takeCompAuditionLane)).disabled, false);
		await act(async () => { root.render(render(false, true)); });
		assert.equal(reactProps(button(ENGLISH_COPY.takeCompAuditionLane)).disabled, true, 'read-only does not hide the recording block');
		await act(async () => { root.render(render(true)); });
		assert.equal(reactProps(button(ENGLISH_COPY.takeCompAuditionLane)).disabled, true, 'locked track policy remains');
	} finally {
		finish();
		await act(async () => { root.unmount(); });
		dom.restore();
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
	}
});

function project(locked: boolean) {
	return createAudioEditorProjectV17({
		id: 'takes', title: 'Takes', now: '2026-10-07T00:00:00.000Z',
		sources: [createAudioSource({ id: 'source', storageKey: 'source', name: 'Take A',
			frameCount: 1000, channelCount: 1, sampleRate: 48_000 })],
		tracks: [createAudioTrack({ id: 'track', name: 'Vocal', clipIds: [], locked })],
		sequences: [{ id: 'sequence', trackIds: ['track'] }], primarySequenceId: 'sequence',
		takeGroups: [{ id: 'group', sequenceId: 'sequence', trackId: 'track', startSample: 0, endSample: 1000,
			laneOrder: ['lane'], lanes: [{ id: 'lane' }],
			takes: [{ id: 'take', laneId: 'lane', sourceId: 'source', startSample: 0, endSample: 1000, sourceStartSample: 0 }],
			compRegions: [{ id: 'region', takeId: 'take', startSample: 0, endSample: 1000 }] }],
	});
}

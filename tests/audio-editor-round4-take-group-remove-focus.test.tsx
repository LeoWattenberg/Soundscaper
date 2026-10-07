/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import TakeCompDialog from '../src/common/editor/ui/dialogs/TakeCompDialog.tsx';
import { createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const destination of ['group-picker', 'close', 'other-control'] as const) {
	test(`take group removal preserves the ${destination} focus destination after completion`, async () => {
		const dom = installReactTestDom();
		const root = createRoot(dom.container as unknown as HTMLElement);
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		let finish: () => void = () => undefined;
		const pending = new Promise<void>(resolve => { finish = resolve; });
		const removed: string[] = [];
		const controller = { actions: { takeComp: {
			auditionTake() {}, auditionLane() {}, stopAudition() {}, promoteTake() {},
			editCompBoundary() {}, editSharedCompBoundary() {}, flatten() {},
			removeGroup(id: string) { removed.push(id); return pending; },
		} } };
		const original = project();
		const render = async (keepRemoved: boolean): Promise<void> => {
			await act(async () => { root.render(<>
				<button data-other-control type="button">Other authoring</button>
				<TakeCompDialog productId="soundscaper" controller={controller}
					snapshot={{ project: { ...original, takeGroups: original.takeGroups.filter(group =>
						keepRemoved || (destination === 'group-picker' && group.id === 'second')) } }}
					copy={ENGLISH_COPY} run={operation => operation()} onClose={() => undefined} />
			</>); });
		};
		try {
			await render(true);
			const remove = dom.container.querySelectorAll('button').find(button => button.textContent === ENGLISH_COPY.takeCompRemoveGroup);
			assert.ok(remove); remove.focus();
			await act(async () => { reactProps(remove).onClick?.({ currentTarget: remove }); });
			const other = dom.one('[data-other-control]');
			if (destination === 'other-control') other.focus();
			await render(false);
			assert.deepEqual(removed, ['first']);
			await act(async () => { finish(); await pending; });
			const close = dom.container.querySelectorAll('button').filter(button => button.textContent === ENGLISH_COPY.close).at(-1);
			assert.ok(close);
			assert.equal(document.activeElement, destination === 'other-control' ? other
				: destination === 'group-picker' ? dom.one('[data-take-comp-group]') : close);
		} finally {
			finish(); await act(async () => { root.unmount(); });
			dom.restore(); actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		}
	});
}

function project() {
	return createAudioEditorProjectV17({ id: 'project', title: 'Recorded takes', now: '2026-10-07T00:00:00.000Z',
		sources: [createAudioSource({ id: 'source', storageKey: 'source', name: 'Recorded take',
			frameCount: 1_000, channelCount: 1, sampleRate: 48_000 })],
		tracks: [createAudioTrack({ id: 'track', name: 'Vocal', clipIds: [] })],
		sequences: [{ id: 'sequence', trackIds: ['track'] }], primarySequenceId: 'sequence',
		takeGroups: ['first', 'second'].map(id => ({ id, sequenceId: 'sequence', trackId: 'track',
			startSample: id === 'first' ? 100 : 600, endSample: id === 'first' ? 500 : 900, laneOrder: [`lane:${id}`], lanes: [{ id: `lane:${id}` }],
			takes: [{ id: `take:${id}`, laneId: `lane:${id}`, sourceId: 'source', startSample: id === 'first' ? 100 : 600, endSample: id === 'first' ? 500 : 900, sourceStartSample: 0 }],
			compRegions: [],
		})),
	});
}

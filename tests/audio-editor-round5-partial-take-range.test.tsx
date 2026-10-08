/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import TakeCompDialog from '../src/common/editor/ui/dialogs/TakeCompDialog.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

for (const partialFirst of [true, false]) {
	test(`promotion admits the selected take's actual extent with partial first=${String(partialFirst)}`, async () => {
		const dom = installReactTestDom();
		const root = createRoot(dom.container as unknown as Element);
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		const calls: unknown[] = [];
		const controller = { actions: { takeComp: {
			auditionTake() {}, auditionLane() {}, stopAudition() {},
			promoteTake(groupId: string, request: unknown) { calls.push([groupId, request]); },
			editCompBoundary() {}, editSharedCompBoundary() {}, flatten() {}, removeGroup() {},
		} } };
		const original = project(partialFirst);
		const render = async (currentProject: unknown): Promise<void> => {
			await act(async () => { root.render(<TakeCompDialog productId="soundscaper"
				controller={controller} snapshot={{ project: currentProject }} copy={ENGLISH_COPY}
				run={operation => operation()} onClose={() => undefined} />); });
		};
		const button = (label: string): ReactTestElement => {
			const result = dom.container.querySelectorAll('button').find(candidate =>
				candidate.textContent === label || candidate.getAttribute('aria-label') === label);
			assert.ok(result); return result;
		};
		const range = (): string[] => dom.container.querySelectorAll('[data-timecode-direct-entry]')
			.slice(0, 2).map(input => input.value);
		try {
			await render(original);
			if (!partialFirst) await act(async () => { reactProps(button('Select Partial')).onClick({}); });
			assert.deepEqual(range(), ['100', '300']);
			assert.equal(reactProps(button(ENGLISH_COPY.takeCompPromoteAll)).disabled, true);
			await act(async () => { reactProps(button(ENGLISH_COPY.takeCompPromoteRange)).onClick({}); });
			assert.deepEqual(calls, [['group', { takeId: 'partial', startSample: 100, endSample: 300 }]]);
			await act(async () => { reactProps(button('Select Full')).onClick({}); });
			assert.notEqual(reactProps(button(ENGLISH_COPY.takeCompPromoteAll)).disabled, true);
			await act(async () => { reactProps(dom.one('[data-timecode-direct-entry]')).onChange({
				currentTarget: { valueAsNumber: 200 },
			}); });
			await render({ ...original, takeGroups: original.takeGroups.map(group => ({ ...group,
				compRegions: [{ id: 'region', takeId: 'partial', startSample: 100, endSample: 300 }],
			})) });
			assert.deepEqual(range(), ['200', '300'], 'unrelated comp publications retain valid range drafts');
			await act(async () => { reactProps(button('Select Partial')).onClick({}); });
			assert.deepEqual(range(), ['200', '300']);
			assert.equal(dom.container.querySelectorAll('[data-timecode-direct-entry]')[1]!.getAttribute('max'), '300',
				'field admission uses the selected take rather than the larger group');
		} finally {
			await act(async () => { root.unmount(); }); dom.restore();
			actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		}
	});
}

function project(partialFirst: boolean) {
	const takes = [{ id: 'partial', laneId: 'partial-lane', sourceId: 'partial-source',
		startSample: 100, endSample: 300, sourceStartSample: 0 },
	{ id: 'full', laneId: 'full-lane', sourceId: 'full-source',
		startSample: 100, endSample: 500, sourceStartSample: 0 }];
	return createAudioEditorProjectV17({ id: 'project', title: 'Recorded takes', now: '2026-10-08T00:00:00.000Z',
		sources: ['partial', 'full'].map(id => createAudioSource({ id: `${id}-source`, storageKey: id,
			name: id === 'partial' ? 'Partial' : 'Full', frameCount: 1_000, channelCount: 1, sampleRate: 48_000 })),
		tracks: [createAudioTrack({ id: 'track', name: 'Vocal', clipIds: [] })],
		sequences: [{ id: 'sequence', trackIds: ['track'] }], primarySequenceId: 'sequence',
		takeGroups: [{ id: 'group', sequenceId: 'sequence', trackId: 'track', startSample: 100, endSample: 500,
			laneOrder: partialFirst ? ['partial-lane', 'full-lane'] : ['full-lane', 'partial-lane'],
			lanes: [{ id: 'partial-lane' }, { id: 'full-lane' }],
			takes: partialFirst ? takes : [...takes].reverse(), compRegions: [],
		}],
	});
}

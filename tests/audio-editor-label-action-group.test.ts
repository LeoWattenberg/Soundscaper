/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEditorLabelActionGroup } from '../src/common/editor/controller/composition/label-action-group.ts';

test('the label action group stays frozen and resolves each owner only at invocation', async () => {
	const calls: Array<readonly [string, ...unknown[]]> = [];
	let trackReads = 0;
	let labelReads = 0;
	const labels = createEditorLabelActionGroup({
		getTrack: () => {
			trackReads += 1;
			return {
				addLabel: (...args: unknown[]) => {
					calls.push(['add', ...args]);
					return 'label-created';
				},
			};
		},
		getLabelService: () => {
			labelReads += 1;
			return {
				importLabelFile: async (...args: unknown[]) => {
					calls.push(['import-file', ...args]);
					return null;
				},
				importCueFile: async (...args: unknown[]) => {
					calls.push(['import-cue', ...args]);
					return null;
				},
				exportLabels: async (...args: unknown[]) => {
					calls.push(['export', ...args]);
					return {
						format: 'txt', text: '', fileName: 'labels.txt', mimeType: 'text/plain',
						labelCount: 0, trackIds: [],
					};
				},
			};
		},
		commit: (command) => {
			calls.push(['commit', command]);
			return command;
		},
	});

	assert.equal(Object.isFrozen(labels), true);
	assert.deepEqual(Object.keys(labels), ['add', 'update', 'remove', 'importFile', 'importCueFile', 'export']);
	assert.deepEqual([trackReads, labelReads], [0, 0]);
	assert.equal(labels.add('label-track', { title: 'Marker' }), 'label-created');
	assert.deepEqual([trackReads, labelReads], [1, 0]);
	assert.deepEqual(labels.update('label-track', 'label', { title: 'Updated' }), {
		type: 'label/update', trackId: 'label-track', labelId: 'label', changes: { title: 'Updated' },
	});
	assert.deepEqual(labels.remove('label-track', 'label'), {
		type: 'label/remove', trackId: 'label-track', labelId: 'label',
	});
	await labels.importFile(null);
	await labels.importCueFile(null, 'markers');
	await labels.export({ format: 'txt' });
	assert.deepEqual([trackReads, labelReads], [1, 3]);
	assert.deepEqual(calls, [
		['add', 'label-track', { title: 'Marker' }],
		['commit', { type: 'label/update', trackId: 'label-track', labelId: 'label', changes: { title: 'Updated' } }],
		['commit', { type: 'label/remove', trackId: 'label-track', labelId: 'label' }],
		['import-file', null],
		['import-cue', null, 'markers'],
		['export', { format: 'txt' }],
	]);
});

test('synchronous owner failures become rejected promises for asynchronous label actions', async () => {
	const labels = createEditorLabelActionGroup({
		getTrack: () => { throw new Error('track unavailable'); },
		getLabelService: () => { throw new Error('labels unavailable'); },
		commit: () => { throw new Error('document unavailable'); },
	});

	assert.throws(() => labels.add(), /track unavailable/u);
	assert.throws(() => labels.update(null, 'label', {}), /document unavailable/u);
	await assert.rejects(labels.importCueFile(null, 'labels'), /labels unavailable/u);
});

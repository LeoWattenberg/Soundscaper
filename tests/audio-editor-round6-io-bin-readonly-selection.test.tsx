/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import ProjectBinPanel from '../src/common/editor/ui/workspace/ProjectBinPanel.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('Project bin allows selecting existing instances in a read-only tab while preserving mutation and busy guards', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousReact = globals.React, previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const source = { id: 'source', kind: 'audio', name: 'Interview.wav', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 };
	const clip = { id: 'bin', kind: 'audio', sourceId: source.id, title: 'Interview',
		durationFrames: 48_000, sourceDurationFrames: 48_000, sourceStartFrame: 0 };
	const project = { id: 'project', revision: 2, sampleRate: 48_000,
		clips: [{ ...clip, id: 'instance', timelineStartFrame: 0 }], tracks: [],
		sources: [source], projectBin: { clips: [clip] } };
	let instances = 1;
	const selected: string[] = [];
	const controller = { actions: { projectBin: { getVisualData: () => null,
		instanceCount: () => instances, selectInstances: (id: string) => { selected.push(id); } } } };
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const render = async (state: Readonly<{ readOnly?: boolean; exporting?: boolean }>): Promise<void> => {
		await act(async () => root.render(React.createElement(ProjectBinPanel, {
			controller, snapshot: { project, ...state }, copy: ENGLISH_COPY, locale: 'en',
			fileService: {}, run: (action: () => unknown) => action(), blocked: Boolean(state.exporting),
		})));
	};
	const selection = () => reactProps(dom.one('[aria-label="Select all instances: Interview"]'));
	try {
		await render({ readOnly: true });
		assert.equal(reactProps(dom.one('[aria-label="Add to timeline: Interview"]')).disabled, true);
		assert.equal(selection().disabled, false, 'selection must remain available after losing the editing lease');
		await act(async () => { selection().onClick?.(); });
		assert.deepEqual(selected, ['bin']);
		assert.equal(project.revision, 2);
		await render({ readOnly: true, exporting: true });
		assert.equal(selection().disabled, true, 'an active export still blocks selection changes');
		instances = 0;
		// Instance counts memoize against the document inventories, as in production.
		project.clips = [];
		await render({ readOnly: true });
		assert.equal(selection().disabled, true, 'a bin entry with no timeline instance cannot select one');
	} finally {
		await act(async () => root.unmount());
		globals.React = previousReact; globals.IS_REACT_ACT_ENVIRONMENT = previousAct; dom.restore();
	}
});

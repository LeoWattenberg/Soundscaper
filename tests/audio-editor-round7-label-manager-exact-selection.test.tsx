/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { LabelManagerRow } from '../src/common/editor/ui/workspace/LabelManagerRows.jsx';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const endFrame of [9_600, 19_200]) test(`Manage labels selects the exact authored 9600..${endFrame} with Snap`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `round7-label-manager-exact-${endFrame}` }),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	await controller.actions.generators.generate('tone', { amplitude: .4, channelCount: 1, durationSeconds: .8, frequency: 440 });
	controller.actions.labels.add(null, { startFrame: 9_600, endFrame, title: 'Authored region' });
	const track = controller.project!.tracks.find(track => track.type === 'label');
	assert.ok(track && Array.isArray(track.labels));
	const label = track.labels[0] as Readonly<Record<string, unknown>>;
	assert.equal(label.startFrame, 9_600);
	assert.equal(label.endFrame, endFrame);
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorReact = globals.React; const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => { root.render(<LabelManagerRow label={{ ...label, trackId: track.id, trackName: track.name }}
			sampleRate={48_000} copy={ENGLISH_COPY} controller={controller} disabled={false} run={(operation: () => unknown) => operation()} />); });
		const select = dom.container.querySelectorAll('button').at(-1);
		assert.ok(select);
		controller.actions.timeline.clearSelection();
		await act(async () => { reactProps(select).onClick({ currentTarget: select }); });
		assert.equal(controller.project!.selection.startFrame, 9_600);
		assert.equal(controller.project!.selection.endFrame, endFrame);
		controller.actions.timeline.setSnap({ enabled: true, unit: 'seconds', mode: 'nearest' });
		controller.actions.timeline.clearSelection();
		const media = structuredClone(controller.project!.clips);
		const history = controller.getSnapshot().history;
		await act(async () => { reactProps(select).onClick({ currentTarget: select }); });
		assert.equal(controller.project!.selection.startFrame, 9_600);
		assert.equal(controller.project!.selection.endFrame, endFrame);
		assert.deepEqual(controller.project!.clips, media);
		assert.deepEqual(controller.getSnapshot().history, history);
		assert.deepEqual(controller.project!.tracks.find(candidate => candidate.id === track.id)!.labels, [label]);
	} finally {
		await act(async () => { root.unmount(); });
		globals.React = priorReact; globals.IS_REACT_ACT_ENVIRONMENT = priorAct; dom.restore();
	}
});

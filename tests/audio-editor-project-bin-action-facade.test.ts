/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createGroupedEditorActions } from '../src/common/editor/controller/composition/action-facade.ts';
import { createEditorProjectBinActionGroup } from '../src/common/editor/controller/composition/project-bin-action-group.ts';
import { createActionFacadeRuntime } from './helpers/action-facade-runtime-fixture.ts';

const EXPECTED_PROJECT_BIN_ACTIONS = Object.freeze([
	'moveFromTimeline', 'place', 'rename', 'setColor', 'remove', 'removeFromBin',
	'removeFromProject', 'selectInstances', 'instanceCount', 'prepareReplacement',
	'applyReplacement', 'cancelReplacement', 'canRelinkLinkedAudio',
	'classifyLinkedAudioRelink', 'relinkLinkedAudio', 'canRelinkLinkedVideo',
	'classifyLinkedVideoRelink', 'relinkLinkedVideo', 'playPause', 'stopPreview',
	'getVisualData',
]);

test('controller action facade preserves branded Project Bin identity and exact keys', () => {
	const runtime = createActionFacadeRuntime();
	const projectBin = createGroupedEditorActions(runtime).projectBin;

	assert.equal(projectBin, runtime.projectBin);
	assert.deepEqual(Object.keys(projectBin), EXPECTED_PROJECT_BIN_ACTIONS);
	assert.equal(Object.isFrozen(projectBin), true);
});

test('controller action facade forwards the exact linked-video relink snapshot', async () => {
	const calls: unknown[][] = [];
	const base = createActionFacadeRuntime();
	const runtime = new Proxy(base, {
		get(target, name, receiver) {
			if (name === 'projectBin') return projectBinActionGroup({
				relinkLinkedVideo: (...args: unknown[]) => { calls.push(args); return 'video-source'; },
			});
			return Reflect.get(target, name, receiver);
		},
	});
	const relink = createGroupedEditorActions(runtime).projectBin.relinkLinkedVideo;
	const file = new File(['video'], 'selected.mp4', { type: 'video/mp4' });
	const locator = Object.freeze({ locatorId: 'locator-selected', locatorRevision: 'revision-selected' });

	assert.equal(await relink('bin-video', file, locator), 'video-source');
	assert.deepEqual(calls, [['bin-video', file, locator]]);
});

test('controller action facade keeps linked-audio eligibility and relink pathless', async () => {
	const calls: Array<readonly [string, ...unknown[]]> = [];
	const base = createActionFacadeRuntime();
	const runtime = new Proxy(base, {
		get(target, name, receiver) {
			if (name === 'projectBin') return projectBinActionGroup({
				canRelinkLinkedAudio: (...args: unknown[]) => {
					calls.push(['eligible', ...args]);
					return true;
				},
				relinkLinkedAudio: (...args: unknown[]) => {
					calls.push(['relink', ...args]);
					return 'audio-source';
				},
			});
			return Reflect.get(target, name, receiver);
		},
	});
	const projectBin = createGroupedEditorActions(runtime).projectBin;
	const file = new File(['audio'], 'selected.wav', { type: 'audio/wav' });
	const locator = Object.freeze({ locatorId: 'locator-selected', locatorRevision: 'revision-selected' });
	const target = Object.freeze({ projectId: 'project-selected', projectRevision: 7 });

	assert.equal(await projectBin.canRelinkLinkedAudio('bin-audio'), true);
	assert.equal(await projectBin.relinkLinkedAudio('bin-audio', file, locator, target), 'audio-source');
	assert.deepEqual(calls, [
		['eligible', 'bin-audio'],
		['relink', 'bin-audio', file, locator, target],
	]);
});

function projectBinActionGroup(overrides: Readonly<Record<string, (...args: unknown[]) => unknown>>) {
	const noOp = () => undefined;
	const service = new Proxy<Record<string, unknown>>({}, {
		get: (_target, name) => overrides[String(name)] ?? noOp,
	});
	return createEditorProjectBinActionGroup({
		getProjectBin: () => service as never,
		getProjectVisual: () => ({ getProjectBinClipVisualData: noOp }) as never,
	});
}

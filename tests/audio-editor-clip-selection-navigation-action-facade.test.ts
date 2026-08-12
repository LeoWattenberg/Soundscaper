/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createGroupedEditorActions,
	type EditorActionRuntime,
} from '../src/common/editor/controller/action-facade.ts';

const ACTIONS = Object.freeze([
	'selectPreviousClipBoundaryToCursor',
	'selectCursorToNextClipBoundary',
	'selectPreviousClip',
	'selectNextClip',
	'skipToSelectionStart',
	'skipToSelectionEnd',
	'selectNoTracks',
] as const);

test('controller timeline facade exposes every clip-selection navigation action', () => {
	const calls: string[] = [];
	const clipNavigation = Object.freeze(Object.fromEntries(ACTIONS.map((name) => [
		name,
		() => { calls.push(name); return name; },
	])));
	const callable = () => undefined;
	const runtime = new Proxy<Record<string, unknown>>({}, {
		get(_target, name) {
			if (name === 'selectionViewService') return { clipNavigation };
			if (name === 'capabilities') return new Proxy({}, { get: () => true });
			if (name === 'product') return { name: 'Soundscaper' };
			if (name === 'copy') return { projectNotFound: 'Not found', localSourcesMissing: 'Missing' };
			if (name === 'state') return { recentProjectIds: [], projects: [], preferences: { recording: {} }, effectPresets: {} };
			if (name === 'videoTrimServices') return {
				edge: { preview: callable, commit: callable, commitStep: callable },
				rollRipple: { preview: callable, commit: callable },
				slipSlide: { buildStepRequest: callable, preview: callable, commit: callable },
				rateStretch: { preview: callable, commit: callable, commitStep: callable },
			};
			if (name === 'engine' || name === 'analysisService' || name === 'store') {
				return new Proxy({}, { get: () => callable });
			}
			if (name === 'AUDIO_EDITOR_DEFAULT_SHORTCUTS') return {};
			return callable;
		},
	}) as EditorActionRuntime;

	const timeline = createGroupedEditorActions(runtime).timeline;
	for (const name of ACTIONS) {
		const action = timeline[name];
		assert.equal(typeof action, 'function', name);
		if (typeof action !== 'function') throw new TypeError(`Missing timeline action: ${name}.`);
		assert.equal(action(), name);
	}
	assert.deepEqual(calls, ACTIONS);
	assert.equal(Object.isFrozen(timeline), true);
});

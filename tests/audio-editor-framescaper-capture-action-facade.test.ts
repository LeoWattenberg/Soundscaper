/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createGroupedEditorActions,
	type EditorActionRuntime,
} from '../src/common/editor/controller/action-facade.ts';

test('controller action facade exposes frozen optional Framescaper capture actions', () => {
	const calls: string[] = [];
	const callable = () => undefined;
	const captureActions = {
		start: () => { calls.push('start'); },
		stop: () => { calls.push('stop'); },
	};
	const runtime = new Proxy<Record<string, unknown>>({}, {
		get(_target, name) {
			if (name === 'framescaperCaptureActions') return captureActions;
			if (name === 'capabilities') return new Proxy({}, { get: () => true });
			if (name === 'product') return { name: 'Framescaper' };
			if (name === 'videoTrimServices') return {
				edge: {}, rollRipple: {}, slipSlide: {}, rateStretch: {},
			};
			if (name === 'copy') return {};
			if (name === 'state') return {
				recentProjectIds: [], projects: [], preferences: { recording: {} },
				audacityEffectType: 'amplify', effectPresets: {},
			};
			if (name === 'engine' || name === 'analysisService' || name === 'store') {
				return new Proxy({}, { get: () => callable });
			}
			if (name === 'AUDIO_EDITOR_DEFAULT_SHORTCUTS') return {};
			return callable;
		},
	}) as EditorActionRuntime;
	const capture = createGroupedEditorActions(runtime).capture;
	const start = capture.start, stop = capture.stop;
	if (typeof start !== 'function' || typeof stop !== 'function') {
		throw new TypeError('The capture action facade is unavailable.');
	}
	start(); stop();
	assert.deepEqual(calls, ['start', 'stop']);
	assert.equal(Object.isFrozen(capture), true);
});

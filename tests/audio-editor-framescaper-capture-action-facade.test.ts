/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createGroupedEditorActions,
} from '../src/common/editor/controller/composition/action-facade.ts';
import { createActionFacadeRuntime } from './helpers/action-facade-runtime-fixture.ts';

test('controller action facade exposes frozen optional Framescaper capture actions', () => {
	const calls: string[] = [];
	const captureActions = {
		start: () => { calls.push('start'); },
		stop: () => { calls.push('stop'); },
	};
	const runtime = new Proxy(createActionFacadeRuntime(), {
		get(target, name, receiver) {
			if (name === 'framescaperCaptureActions') return captureActions;
			if (name === 'product') return { name: 'Framescaper' };
			return Reflect.get(target, name, receiver);
		},
	});
	const capture = createGroupedEditorActions(runtime).capture;
	const start = capture.start, stop = capture.stop;
	if (typeof start !== 'function' || typeof stop !== 'function') {
		throw new TypeError('The capture action facade is unavailable.');
	}
	void start(); void stop();
	assert.deepEqual(calls, ['start', 'stop']);
	assert.equal(Object.isFrozen(capture), true);
});

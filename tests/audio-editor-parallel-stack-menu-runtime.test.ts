/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createParallelStackMenuRuntime } from '../src/common/editor/ui/workspace/parallel-stack-menu-runtime.ts';
import {
	cancelParallelStackPreparation, prepareParallelStackPlayback, registerParallelStackPlayback,
	type ParallelStackPlaybackRequest,
} from '../src/common/editor/engine/parallel-stack-playback.ts';
import { readParallelStackPreferences, writeParallelStackPreferences } from '../src/common/editor/engine/parallel-stack-preferences.ts';
import { appendParallelStackProcessingMenu } from '../src/common/editor/ui/parallel-stack-menu.ts';
import { materializeApplicationMenu } from '../src/common/editor/ui/application-menu-materialization.ts';

test('parallel processing menu guards the live transport after a stopped menu was opened', () => {
	let playing = false;
	let recording = false;
	const runtime = createParallelStackMenuRuntime({
		productId: 'soundscaper', desktop: true, recording: false,
		controller: {
			engine: { getState: () => ({ state: playing ? 'playing' : 'stopped' }) },
			getSnapshot: () => ({ recording }),
		},
		run: (operation) => operation(),
	});
	assert.ok(runtime);
	assert.equal(runtime.blocked, false);
	const menu = appendParallelStackProcessingMenu([], runtime, runtime.change)[0]!;
	const original = readParallelStackPreferences();
	try {
		playing = true;
		assert.equal(materializeApplicationMenu(menu).items?.[0]?.items?.[0]?.disabled, true);
		assert.throws(() => runtime.change({ enabled: true }), /Stop playback and recording/);
		playing = false;
		recording = true;
		assert.throws(() => runtime.change({ workerLimit: 8 }), /Stop playback and recording/);
		recording = false;
		assert.equal(materializeApplicationMenu(menu).items?.[0]?.items?.[0]?.disabled, false);
		runtime.change({ enabled: true });
		runtime.change({ workerLimit: 2 });
		assert.equal(readParallelStackPreferences().enabled, true);
		assert.equal(readParallelStackPreferences().workerLimit, 2);
	} finally { writeParallelStackPreferences(original); }
});

test('parallel processing runtime is omitted outside the Soundscaper desktop', () => {
	for (const [productId, desktop] of [['soundscaper', false], ['framescaper', true]] as const) {
		assert.equal(createParallelStackMenuRuntime({
			productId, desktop, recording: false, run: (operation) => operation(),
		}), null);
	}
});

test('settings cannot change while Play is preparing and the engine still reports stopped', () => {
	let pendingPlayRequest = 0;
	const runtime = createParallelStackMenuRuntime({
		productId: 'soundscaper', desktop: true, recording: false,
		controller: {
			engine: {
				getState: () => ({ state: 'stopped' }),
				get pendingPlayRequest() { return pendingPlayRequest; },
			},
		},
		run: (operation) => operation(),
	});
	assert.ok(runtime);
	const before = readParallelStackPreferences();
	const menu = appendParallelStackProcessingMenu([], runtime, runtime.change)[0]!;
	pendingPlayRequest = 1;
	assert.equal(materializeApplicationMenu(menu).items?.[0]?.items?.[0]?.disabled, true);
	assert.throws(() => runtime.change({ enabled: !before.enabled }), /Stop playback and recording/);
	assert.deepEqual(readParallelStackPreferences(), before);
});

test('settings cannot change during an unsequenced parallel graph preparation', async () => {
	const engine = { getState: () => ({ state: 'stopped' }) };
	registerParallelStackPlayback(engine, (_request, signal) => new Promise((resolve) => {
		signal.addEventListener('abort', () => resolve(null), { once: true });
	}));
	const preparing = prepareParallelStackPlayback(engine, {} as ParallelStackPlaybackRequest);
	const runtime = createParallelStackMenuRuntime({
		productId: 'soundscaper', desktop: true, recording: false,
		controller: { engine }, run: (operation) => operation(),
	});
	assert.ok(runtime);
	assert.equal(runtime.blocked, true);
	assert.throws(() => runtime.change({ workerLimit: 4 }), /Stop playback and recording/);
	cancelParallelStackPreparation(engine);
	await assert.rejects(preparing, { name: 'AbortError' });
});

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorEngine } from '../src/common/editor/engine/runtime-class.ts';
import type { EngineAudioContext } from '../src/common/editor/engine/public-api.ts';
import type { EngineProject } from '../src/common/editor/engine/types.ts';
import type { EngineRuntimeHost } from '../src/common/editor/engine/runtime-types.ts';
import { ENGINE_EMIT_POSITION } from '../src/common/editor/engine/runtime-symbols.ts';
import { subscribeEnginePlayheadDiscontinuity } from '../src/common/editor/engine/playhead-discontinuity.ts';
import { createProject } from './helpers/audio-editor-runtime-harness.js';
import { MockAudioBuffer, MockAudioContext } from './helpers/mock-audio-context.js';

function fixture() {
	const context = new MockAudioContext();
	const engine = createAudioEditorEngine({ audioContextFactory: () => context as unknown as EngineAudioContext });
	engine.loadProject(createProject() as unknown as EngineProject,
		new Map([['source-1', new MockAudioBuffer(1, 48_000, 48_000) as unknown as AudioBuffer]]));
	return { engine, context };
}

test('a small direct engine seek while playing invalidates synchronously before source graph mutation, while clock telemetry stays continuous', async () => {
	const { engine, context } = fixture(); let invalidations = 0; const previous: number[] = [];
	const unsubscribe = subscribeEnginePlayheadDiscontinuity(engine, () => { invalidations++; previous.push(engine.getPositionFrames()); });
	try {
		await engine.play(); context.currentTime += 0.01;
		(engine as unknown as EngineRuntimeHost)[ENGINE_EMIT_POSITION]();
		const old = engine.getPositionFrames(); assert.equal(invalidations, 0);
		engine.seek(old + 1); assert.equal(invalidations, 1); assert.deepEqual(previous, [old]);
		unsubscribe(); unsubscribe(); engine.seek(old + 2); assert.equal(invalidations, 1);
	} finally { unsubscribe(); await engine.dispose(); }
});

test('the actual scrub entry invalidates before its position publication and does not change engine result semantics', async () => {
	const { engine } = fixture(); const events: string[] = [];
	const unsubscribe = subscribeEnginePlayheadDiscontinuity(engine, () => { events.push('invalidate'); });
	const stopPositions = engine.subscribePosition(() => { events.push('position'); });
	try {
		assert.equal(await engine.scrub(25), 25);
		assert.equal(events[0], 'invalidate'); assert.ok(events.indexOf('position') > 0);
	} finally { unsubscribe(); stopPositions(); await engine.dispose(); }
});

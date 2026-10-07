/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createExportPlan } from '../src/common/editor/export.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

function radioProject(entries: readonly Readonly<Record<string, unknown>>[], timers = [{ usage: 'SEC1', value: 24_000 }]) {
	const base = createSoundscaperProject({ id: 'radio', now: '2026-10-07T00:00:00Z',
		tracks: [{ id: 'audio', type: 'audio', name: 'Radio' }] });
	const sequenceId = base.primarySequenceId;
	return createSoundscaperProject({
		...base,
		mixer: undefined,
		sources: [{ id: 'recording', kind: 'audio', name: 'Radio recording', sampleRate: 48_000,
			frameCount: 48_000, channelCount: 1, sampleFormat: 'float32', storageKey: 'recording' }],
		clips: [{ id: 'take', kind: 'audio', sourceId: 'recording', timelineStartFrame: 0,
			sourceStartFrame: 0, durationFrames: 48_000 }],
		tracks: [{ id: 'audio', type: 'audio', name: 'Radio', clipIds: ['take'] }],
		timelineAnnotations: [{ id: 'middle', sequenceId, kind: 'region', anchor: 'sample', name: 'Middle',
			startFrame: 12_000, endFrame: 36_000, color: 'auto', batchId: null, opaqueExtensions: {} }],
		masteringSequences: [{ id: 'order', sequenceId, name: 'Radio order', entries }],
		metadata: { ...base.metadata, cart: { title: 'Radio programme', postTimers: timers } },
	});
}

test('a single mastering region maps broadcast timers into the actual delivered audio', () => {
	const project = radioProject([{ id: 'entry', annotationId: 'middle' }]);
	const plan = createExportPlan(project, { format: 'bwf', masteringSequenceId: 'order' });
	assert.equal(plan.outputFrames, 24_000);
	assert.deepEqual(plan.cart?.postTimers, [{ usage: 'SEC1', value: 12_000 }]);
	assert.deepEqual(project.metadata.cart?.postTimers, [{ usage: 'SEC1', value: 24_000 }]);
});

test('repeated regions and lead-in silence publish each timer occurrence in the delivered clock', () => {
	const project = radioProject([
		{ id: 'one', annotationId: 'middle', gapBeforeFrames: 4_800 },
		{ id: 'two', annotationId: 'middle', gapBeforeFrames: 9_600 },
	], [{ usage: 'SEC1', value: 24_000 }, { usage: 'INT ', value: 4_800 }, { usage: 'EOD ', value: 48_000 }]);
	const plan = createExportPlan(project, { format: 'bwf', masteringSequenceId: 'order', sampleRate: 96_000 });
	assert.equal(plan.outputFrames, 124_800);
	assert.deepEqual(plan.cart?.postTimers, [{ usage: 'SEC1', value: 33_600 }, { usage: 'SEC1', value: 100_800 }]);
});

test('ordinary contiguous radio deliveries retain their original range conversion', () => {
	const plan = createExportPlan(radioProject([{ id: 'entry', annotationId: 'middle' }]), {
		format: 'bwf', range: { startFrame: 12_000, endFrame: 36_000 }, sampleRate: 96_000,
	});
	assert.deepEqual(plan.cart?.postTimers, [{ usage: 'SEC1', value: 24_000 }]);
});

test('a repeated radio delivery refuses more timer occurrences than CART can represent', () => {
	const project = radioProject(Array.from({ length: 9 }, (_, index) => ({ id: `entry-${String(index)}`, annotationId: 'middle' })));
	assert.throws(() => createExportPlan(project, { format: 'bwf', masteringSequenceId: 'order' }), /at most eight post timers/u);
});

test('source-end radio cues follow the independently rounded delivered region boundary', () => {
	const project = radioProject([{ id: 'entry', annotationId: 'middle', gapBeforeFrames: 4_800 }], [{ usage: 'EOD ', value: 36_000 }]);
	const plan = createExportPlan(project, { format: 'bwf', masteringSequenceId: 'order', sampleRate: 44_100 });
	assert.deepEqual(plan.cart?.postTimers, [{ usage: 'EOD ', value: plan.outputFrames }]);
});

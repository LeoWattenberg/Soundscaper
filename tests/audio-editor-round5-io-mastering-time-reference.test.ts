/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createExportPlan } from '../src/common/editor/export.js';

function productionProject(gapBeforeFrames = 0, timeReference = '480000') {
	const base = createSoundscaperProject({ id: 'production', tracks: [{ id: 'audio', type: 'audio', name: 'Takes' }] });
	return createSoundscaperProject({ ...base, mixer: undefined,
		sources: [{ id: 'recording', kind: 'audio', name: 'Takes', sampleRate: 48_000, frameCount: 48_000,
			channelCount: 1, sampleFormat: 'float32', storageKey: 'recording' }],
		clips: [{ id: 'take', kind: 'audio', sourceId: 'recording', timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 48_000 }],
		tracks: [{ id: 'audio', type: 'audio', name: 'Takes', clipIds: ['take'] }],
		metadata: { ...base.metadata, bext: { timeReference, description: 'Production takes' } },
		timelineAnnotations: [
			{ id: 'earlier', sequenceId: base.primarySequenceId, kind: 'region', anchor: 'sample', name: 'Earlier', startFrame: 6_000, endFrame: 18_000, color: 'auto', batchId: null, opaqueExtensions: {} },
			{ id: 'later', sequenceId: base.primarySequenceId, kind: 'region', anchor: 'sample', name: 'Later', startFrame: 24_000, endFrame: 36_000, color: 'auto', batchId: null, opaqueExtensions: {} },
		],
		masteringSequences: [{ id: 'order', sequenceId: base.primarySequenceId, name: 'Later first', entries: [
			{ id: 'first', annotationId: 'later', gapBeforeFrames }, { id: 'second', annotationId: 'earlier' },
		] }],
	});
}

test('BWF assembly references the first delivered take, independently of project and later entry positions', () => {
	const project = productionProject();
	const plan = createExportPlan(project, { format: 'bwf', masteringSequenceId: 'order' });
	assert.equal(plan.masteringSequence?.segments[0]?.sourceStartFrame, 24_000);
	assert.equal(plan.outputFrames, 24_000);
	assert.equal(plan.bext?.timeReference, '504000');
	assert.deepEqual(plan.encoding.bext, plan.bext);
	assert.equal(project.metadata.bext?.timeReference, '480000');
});

test('first-sample time precedes a lead-in by its independently rounded output gap', () => {
	const plan = createExportPlan(productionProject(4_801), { format: 'bwf', masteringSequenceId: 'order', sampleRate: 44_100 });
	const first = plan.masteringSequence?.segments[0];
	assert.ok(first);
	assert.equal(first.outputStartFrame, 4_411);
	assert.equal(plan.bext?.timeReference, String(463_050 - 4_411));
});

test('ordinary contiguous and full-project BWF deliveries keep their existing time references', () => {
	const project = productionProject();
	assert.equal(createExportPlan(project, { format: 'bwf' }).bext?.timeReference, '480000');
	assert.equal(createExportPlan(project, { format: 'bwf', range: { startFrame: 6_000, endFrame: 18_000 } }).bext?.timeReference, '486000');
});

test('the first assembled timestamp preserves uint64 precision and the stated metadata override', () => {
	const plan = createExportPlan(productionProject(), { format: 'bwf', masteringSequenceId: 'order',
		bext: { timeReference: '9007199254740993', description: 'Assembled programme' },
	});
	assert.equal(plan.bext?.timeReference, '9007199254764993');
	assert.equal(plan.bext?.description, 'Assembled programme');
});

test('an unrepresentable lead-in refuses a false unsigned first-sample timestamp', () => {
	assert.throws(() => createExportPlan(productionProject(24_001, '0'), { format: 'bwf', masteringSequenceId: 'order' }), /before midnight|negative/u);
});

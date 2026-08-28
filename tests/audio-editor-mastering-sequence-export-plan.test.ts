/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createExportPlan } from '../src/common/editor/export.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { MasteringSequenceValidationError } from '../src/common/editor/mastering-sequence.ts';
import { createDeliveryReportForPlan } from '../src/common/editor/delivery-conversion-inventory.ts';

const NOW = '2026-08-18T00:00:00.000Z';

function annotation(overrides: Record<string, unknown>, sequenceId: string): Record<string, unknown> {
	return {
		id: String(overrides.id),
		sequenceId,
		name: String(overrides.name ?? overrides.id),
		kind: 'region',
		anchor: 'sample',
		color: 'auto',
		batchId: null,
		opaqueExtensions: {},
		...overrides,
	};
}

function albumProject(entries: readonly unknown[], options: Record<string, unknown> = {}) {
	const base = createSoundscaperProject({
		id: 'album', title: 'Album', now: NOW, revision: 0,
		tracks: [{ type: 'audio', id: 'a1', name: 'A1' }],
	} as never);
	const sequenceId = base.primarySequenceId;
	return createSoundscaperProject({
		id: 'album', title: 'Album', now: NOW, revision: 0,
		sources: [{
			id: 'source', name: 'Source', storageKey: 'pcm/source', mimeType: 'audio/wav',
			frameCount: 1_200_000, channelCount: 2, sampleRate: 48_000, sampleFormat: 'float32',
		}],
		clips: [{
			id: 'clip', kind: 'audio', sourceId: 'source',
			timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 1_200_000,
		}],
		tracks: [{ type: 'audio', id: 'a1', name: 'A1', clipIds: ['clip'] }],
		primarySequenceId: sequenceId,
		sequences: base.sequences,
		timelineAnnotations: [
			annotation({ id: 'r-one', name: 'One', startFrame: 0, endFrame: 480_000 }, sequenceId),
			annotation({ id: 'r-two', name: 'Two', startFrame: 700_000, endFrame: 1_180_000 }, sequenceId),
		],
		masteringSequences: [{ id: 'album-order', sequenceId, name: 'Album order', entries }],
		...options,
	} as never);
}

const ORDER = [
	{ id: 'e1', annotationId: 'r-one' },
	{ id: 'e2', annotationId: 'r-two', gapBeforeFrames: 96_000, fadeOutFrames: 48_000 },
];

test('a sequence delivery is one ordinary plan whose length is the sequence', () => {
	const plan = createExportPlan(albumProject(ORDER), {
		format: 'wav', masteringSequenceId: 'album-order',
	});

	assert.equal(plan.mode, 'mix');
	assert.equal(plan.outputs.length, 1, 'one plan, one artifact');
	assert.equal(plan.outputFrames, 1_056_000, '480000 + 96000 gap + 480000');
	assert.equal(plan.masteringSequence!.sequenceId, 'album-order');
	assert.deepEqual(
		plan.masteringSequence!.segments.map((segment) => [segment.outputStartFrame, segment.outputEndFrame]),
		[[0, 480_000], [576_000, 1_056_000]],
	);
	assert.equal(plan.tailFrames, 0, 'audio past the last region is audio the sequence did not ask for');
	assert.deepEqual(
		{ startFrame: plan.range.startFrame, endFrame: plan.range.endFrame },
		{ startFrame: 0, endFrame: 1_180_000 },
		'the range reports the span of the project the delivery reads',
	);
});

test('the delivered cues are the sequence, at the positions the plan gives them', () => {
	const plan = createExportPlan(albumProject(ORDER), {
		format: 'wav', masteringSequenceId: 'album-order',
	});
	assert.deepEqual(plan.markers.map(({ sampleOffset, label }) => ({ sampleOffset, label })), [
		{ sampleOffset: 0, label: 'One' },
		{ sampleOffset: 576_000, label: 'Two' },
	]);
});

test('the project markers a sequence delivery cannot place are reported, not dropped', () => {
	// The delivered timeline is a splice, so a project-timeline position has no
	// delivered counterpart. Saying so is the difference from losing them quietly.
	const plan = createExportPlan(albumProject(ORDER), {
		format: 'wav', masteringSequenceId: 'album-order',
	});
	const omitted = plan.markerInterchangeReport.items
		.find(({ code }) => code === 'RIFF_MARKER_SOURCE_REPLACED_BY_MASTERING_SEQUENCE');
	assert.equal(omitted?.disposition, 'omitted');
	assert.equal(omitted?.data.itemCount, 2);
	assert.ok(
		createDeliveryReportForPlan(plan, { sampleRate: 48_000 })
			.items.some(({ code }) => code === 'delivery.marker-interchange'),
	);
});

test('the delivery is written in the rate the file uses', () => {
	const plan = createExportPlan(albumProject(ORDER), {
		format: 'wav', masteringSequenceId: 'album-order', sampleRate: 96_000,
	});
	assert.equal(plan.outputFrames, 2_112_000);
	assert.deepEqual(plan.markers.map(({ sampleOffset }) => sampleOffset), [0, 1_152_000]);
	assert.deepEqual(
		plan.masteringSequence!.segments.map((segment) => [segment.sourceStartFrame, segment.sourceEndFrame]),
		[[0, 480_000], [700_000, 1_180_000]],
		'source frames stay in the project rate, because they say what to render',
	);
});

test('a sequence that does not validate refuses the plan with the typed error', () => {
	assert.throws(
		() => createExportPlan(albumProject([{ id: 'e1', annotationId: 'gone' }]), {
			format: 'wav', masteringSequenceId: 'album-order',
		}),
		MasteringSequenceValidationError,
	);
});

test('a delivery names a sequence the project has, or refuses', () => {
	assert.throws(() => createExportPlan(albumProject(ORDER), {
		format: 'wav', masteringSequenceId: 'not-here',
	}), /not in this project/u);
	assert.throws(() => createExportPlan(albumProject(ORDER), {
		format: 'wav', masteringSequenceId: 42,
	}), TypeError);
});

test('a sequence delivers one artifact, never stems and never ADM', () => {
	assert.throws(() => createExportPlan(albumProject(ORDER), {
		format: 'wav', mode: 'stems', masteringSequenceId: 'album-order',
	}), /mix-only/u);
	assert.throws(() => createExportPlan(albumProject(ORDER), {
		format: 'bw64',
		masteringSequenceId: 'album-order',
		adm: {
			mode: 'authored',
			programme: { name: 'Programme', language: 'en' },
			content: { name: 'Content', language: 'en' },
			bed: {
				name: 'stereo bed',
				layout: 'stereo',
				assignments: [
					{ stripKind: 'track', stripId: 'a1', sourceChannel: 0, bedChannel: 'L' },
					{ stripKind: 'track', stripId: 'a1', sourceChannel: 1, bedChannel: 'R' },
				],
			},
		},
		inputChannelCount: 2,
	}), /cannot deliver a mastering sequence/u);
});

test('an ordinary delivery is untouched by any of this', () => {
	const plan = createExportPlan(albumProject(ORDER), { format: 'wav' });
	assert.equal(plan.masteringSequence, undefined);
	assert.deepEqual(plan.markers.map(({ label }) => label), ['One', 'Two']);
	assert.equal(
		plan.markerInterchangeReport.items
			.some(({ code }) => code === 'RIFF_MARKER_SOURCE_REPLACED_BY_MASTERING_SEQUENCE'),
		false,
	);
});

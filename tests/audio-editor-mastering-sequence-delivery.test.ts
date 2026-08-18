/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	MasteringSequenceValidationError,
	createMasteringSequenceV23,
} from '../src/common/editor/mastering-sequence.ts';
import {
	createMasteringSequenceDeliveryPlan,
	masteringSequenceDeliveryCues,
	scaleMasteringSequenceDeliveryPlan,
} from '../src/common/editor/mastering-sequence-delivery.ts';
import {
	countUnreportedDeliveryConversions,
	createDeliveryReportForPlan,
} from '../src/common/editor/delivery-conversion-inventory.ts';
import { createRiffMarkerChunks, parseRiffMarkers } from '../src/common/editor/riff-markers.ts';

const REGIONS = [
	{ id: 'a', sequenceId: 'main', name: 'One', startFrame: 0, endFrame: 480_000 },
	{ id: 'b', sequenceId: 'main', name: 'Two', startFrame: 700_000, endFrame: 1_180_000 },
	{ id: 'c', sequenceId: 'main', name: 'Three', startFrame: 2_000_000, endFrame: 2_240_000 },
];

const sequence = (entries: readonly unknown[]) => createMasteringSequenceV23({
	id: 'album', sequenceId: 'main', name: 'Album order', entries,
});

test('entries are laid out end to end, with each gap owned by the entry after it', () => {
	const plan = createMasteringSequenceDeliveryPlan(sequence([
		{ id: 'e1', annotationId: 'a' },
		{ id: 'e2', annotationId: 'b', gapBeforeFrames: 96_000 },
		{ id: 'e3', annotationId: 'c', gapBeforeFrames: 48_000 },
	]), REGIONS);

	assert.deepEqual(plan.segments.map((segment) => [
		segment.outputStartFrame, segment.outputEndFrame,
	]), [
		[0, 480_000],
		[576_000, 1_056_000],
		[1_104_000, 1_344_000],
	]);
	assert.equal(plan.totalFrames, 1_344_000);
});

test('a lead-in gap on the first entry offsets the whole delivery', () => {
	const plan = createMasteringSequenceDeliveryPlan(sequence([
		{ id: 'e1', annotationId: 'a', gapBeforeFrames: 24_000 },
	]), REGIONS);
	assert.equal(plan.segments[0].outputStartFrame, 24_000);
	assert.equal(plan.totalFrames, 504_000);
});

test('boundaries are exact sample counts, never a rounded duration', () => {
	// Positions accumulate from integer region extents and integer gaps, so the
	// delivered length is the sum of its parts with nothing lost.
	const entries = [
		{ id: 'e1', annotationId: 'a', gapBeforeFrames: 1 },
		{ id: 'e2', annotationId: 'b', gapBeforeFrames: 7 },
		{ id: 'e3', annotationId: 'c', gapBeforeFrames: 13 },
	];
	const plan = createMasteringSequenceDeliveryPlan(sequence(entries), REGIONS);
	const regionFrames = REGIONS.reduce((sum, region) => sum + (region.endFrame - region.startFrame), 0);
	const gapFrames = entries.reduce((sum, entry) => sum + entry.gapBeforeFrames, 0);
	assert.equal(plan.totalFrames, regionFrames + gapFrames);
	for (const segment of plan.segments) {
		assert.ok(Number.isSafeInteger(segment.outputStartFrame));
		assert.ok(Number.isSafeInteger(segment.outputEndFrame));
		assert.equal(
			segment.outputEndFrame - segment.outputStartFrame,
			segment.sourceEndFrame - segment.sourceStartFrame,
			'a delivered entry is exactly as long as the region it renders',
		);
	}
});

test('the delivered order is the authored order, not the timeline order', () => {
	// Region c starts last in the project but is delivered first here.
	const plan = createMasteringSequenceDeliveryPlan(sequence([
		{ id: 'e3', annotationId: 'c' },
		{ id: 'e1', annotationId: 'a' },
	]), REGIONS);
	assert.deepEqual(plan.segments.map((segment) => segment.annotationId), ['c', 'a']);
	assert.equal(plan.segments[0].sourceStartFrame, 2_000_000);
	assert.equal(plan.segments[1].sourceStartFrame, 0);
});

test('titles and delivery metadata reach the plan', () => {
	const plan = createMasteringSequenceDeliveryPlan(sequence([
		{ id: 'e1', annotationId: 'a', title: 'Overture', metadata: { isrc: 'GBAYE0000123' } },
		{ id: 'e2', annotationId: 'b' },
	]), REGIONS);
	assert.equal(plan.segments[0].title, 'Overture');
	assert.deepEqual(plan.segments[0].metadata, { isrc: 'GBAYE0000123' });
	assert.equal(plan.segments[1].title, 'Two', 'an entry with no override shows the region name');
});

test('a sequence that does not validate refuses delivery before any plan exists', () => {
	assert.throws(
		() => createMasteringSequenceDeliveryPlan(
			sequence([{ id: 'e1', annotationId: 'a' }, { id: 'e2', annotationId: 'gone' }]),
			REGIONS,
		),
		MasteringSequenceValidationError,
	);
	assert.throws(
		() => createMasteringSequenceDeliveryPlan(
			sequence([{ id: 'e1', annotationId: 'a', fadeInFrames: 400_000, fadeOutFrames: 400_000 }]),
			REGIONS,
		),
		MasteringSequenceValidationError,
	);
});

test('cues describe positions in the delivered file, and reopen where they were written', () => {
	// The acceptance: cues reopen in the RIFF reader at the emitted positions.
	const plan = createMasteringSequenceDeliveryPlan(sequence([
		{ id: 'e1', annotationId: 'a' },
		{ id: 'e2', annotationId: 'b', gapBeforeFrames: 96_000 },
	]), REGIONS);
	const cues = masteringSequenceDeliveryCues(plan);
	assert.deepEqual(cues.map((cue) => cue.sampleOffset), [0, 576_000]);
	assert.deepEqual(cues.map((cue) => cue.label), ['One', 'Two']);

	// Written and read back through the real chunk mechanics, not a mock.
	const bytes = createRiffMarkerChunks(cues);
	const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const cueSize = header.getUint32(4, true);
	const listOffset = 8 + cueSize + (cueSize & 1);
	const reopened = parseRiffMarkers(
		bytes.subarray(8, 8 + cueSize),
		[bytes.subarray(listOffset + 12, listOffset + 8 + header.getUint32(listOffset + 4, true))],
	);
	assert.deepEqual(
		reopened.map((marker) => marker.sampleOffset),
		[0, 576_000],
		'a cue reopens at the sample it was written at',
	);
	assert.deepEqual(reopened.map((marker) => marker.label), ['One', 'Two']);
	assert.deepEqual(
		reopened.map((marker) => marker.sampleLength),
		[480_000, 480_000],
		'and keeps its extent, so a region cue stays a region',
	);
});

test('an empty sequence delivers nothing rather than failing', () => {
	const plan = createMasteringSequenceDeliveryPlan(sequence([]), REGIONS);
	assert.deepEqual(plan.segments, []);
	assert.equal(plan.totalFrames, 0);
	assert.deepEqual(masteringSequenceDeliveryCues(plan), []);
});

test('the plan is frozen data a delivery can carry without defensive copying', () => {
	const plan = createMasteringSequenceDeliveryPlan(sequence([{ id: 'e1', annotationId: 'a' }]), REGIONS);
	assert.ok(Object.isFrozen(plan) && Object.isFrozen(plan.segments) && Object.isFrozen(plan.segments[0]));
});

const deliveryPlan = (format: string, masteringSequence: unknown) => ({
	format,
	sampleRate: 48_000,
	ditherMode: 'none',
	encoding: { channelCount: 2, sampleFormat: 'float32', floatingPoint: true, inputChannelCount: 2 },
	masteringSequence,
});

test('every entry reaches the delivery report with its position and metadata', () => {
	// Per-region metadata that reached the audio but not the report would be a
	// delivery decision nobody can see, so the items are derived from the plan
	// rather than appended by whoever wrote the export path.
	const plan = createMasteringSequenceDeliveryPlan(sequence([
		{ id: 'e1', annotationId: 'a', title: 'Overture', metadata: { isrc: 'GBAYE0000123' } },
		{ id: 'e2', annotationId: 'b', gapBeforeFrames: 96_000 },
	]), REGIONS);

	const report = createDeliveryReportForPlan(deliveryPlan('wav', plan), { sampleRate: 48_000 });

	const entries = report.items.filter(({ code }) => code === 'delivery.mastering-sequence-entry');
	assert.equal(entries.length, 2);
	assert.equal(entries[0].scope.id, 'e1');
	assert.equal(entries[0].data.title, 'Overture');
	assert.deepEqual(entries[0].data.metadata, { isrc: 'GBAYE0000123' });
	assert.equal(entries[1].data.outputStartFrame, 576_000);
	assert.equal(entries[1].data.gapBeforeFrames, 96_000);
	assert.ok(report.items.some(({ code }) => code === 'delivery.mastering-sequence-cues'));
});

test('a format that cannot carry cues reports the omission, and the gate observes it', () => {
	const plan = createMasteringSequenceDeliveryPlan(sequence([{ id: 'e1', annotationId: 'a' }]), REGIONS);
	const exportPlan = deliveryPlan('mp3', plan);

	const report = createDeliveryReportForPlan(exportPlan, { sampleRate: 48_000 });
	const omission = report.items.find(({ code }) => code === 'delivery.mastering-sequence-cues-omitted');
	assert.equal(omission?.disposition, 'omitted');
	assert.equal(omission?.severity, 'warning');
	assert.equal(
		report.items.some(({ code }) => code === 'delivery.mastering-sequence-cues'),
		false,
		'a delivery must not claim cues it did not write',
	);

	// The acceptance: the omission is inventoried from the plan, so a report that
	// left it out would be counted rather than believed.
	assert.equal(countUnreportedDeliveryConversions(exportPlan, { sampleRate: 48_000 }, report), 0);
	assert.equal(
		countUnreportedDeliveryConversions(exportPlan, { sampleRate: 48_000 }, {
			items: report.items.filter(({ code }) => code !== 'delivery.mastering-sequence-cues-omitted'),
		}),
		1,
		'and a report that dropped just this item would not pass',
	);
});

test('an empty sequence says nothing about cues either way', () => {
	const report = createDeliveryReportForPlan(
		deliveryPlan('mp3', createMasteringSequenceDeliveryPlan(sequence([]), REGIONS)),
		{ sampleRate: 48_000 },
	);
	assert.equal(
		report.items.some(({ code }) => String(code).startsWith('delivery.mastering-sequence')),
		false,
	);
});

test('a delivery is expressed in the rate it is written at, part by part', () => {
	// Scaling each gap and extent on its own and accumulating keeps the delivered
	// length the exact sum of its parts; scaling the accumulated positions would
	// let rounding drift a boundary away from the audio it belongs to.
	const plan = createMasteringSequenceDeliveryPlan(sequence([
		{ id: 'e1', annotationId: 'a' },
		{ id: 'e2', annotationId: 'b', gapBeforeFrames: 96_000, fadeInFrames: 4_800 },
	]), REGIONS);
	const scaled = scaleMasteringSequenceDeliveryPlan(plan, {
		sourceSampleRate: 48_000, outputSampleRate: 96_000,
	});

	assert.deepEqual(scaled.segments.map((segment) => [
		segment.outputStartFrame, segment.outputEndFrame,
	]), [[0, 960_000], [1_152_000, 2_112_000]]);
	assert.equal(scaled.totalFrames, 2_112_000);
	assert.equal(scaled.segments[1].fadeInFrames, 9_600);
	assert.deepEqual(
		scaled.segments.map((segment) => [segment.sourceStartFrame, segment.sourceEndFrame]),
		plan.segments.map((segment) => [segment.sourceStartFrame, segment.sourceEndFrame]),
		'source frames say what to render, not what was written, so they keep the project rate',
	);
	assert.equal(
		scaled.totalFrames,
		scaled.segments.reduce((sum, segment) => sum
			+ segment.gapBeforeFrames + (segment.outputEndFrame - segment.outputStartFrame), 0),
		'the delivered length is the sum of its scaled parts',
	);
	assert.equal(
		scaleMasteringSequenceDeliveryPlan(plan, { sourceSampleRate: 48_000, outputSampleRate: 48_000 }),
		plan,
		'and an unchanged rate is the same plan, not a copy of it',
	);
});

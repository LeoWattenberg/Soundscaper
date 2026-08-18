/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createExportPlan } from '../src/common/editor/export.js';
import {
	addDeliveryReportItem,
	createDeliveryReport,
	sealDeliveryReport,
} from '../src/common/editor/delivery-report.ts';
import {
	countUnreportedDeliveryConversions,
	createDeliveryReportForPlan,
	inventoryDeliveryConversions,
} from '../src/common/editor/delivery-conversion-inventory.ts';

function audioProject(sampleRate = 48_000) {
	return {
		id: 'delivery-report-project',
		title: 'Delivery',
		sampleRate,
		masterChannels: 2,
		selection: { startFrame: 0, endFrame: 0 },
		loop: { enabled: false, startFrame: 0, endFrame: 0 },
		sources: [],
		clips: [],
		tracks: [{
			type: 'audio',
			id: 'track-a',
			name: 'Audio',
			clipIds: [],
			mute: false,
			solo: false,
			hidden: false,
			collapsed: false,
			height: 120,
			laneGroupId: null,
		}],
	};
}

const source = { sampleRate: 48_000 };
const RANGE = { startFrame: 0, endFrame: 48_000 };

test('a wav delivery at the project rate reports quantization and lossless preservation', () => {
	const plan = createExportPlan(audioProject(), { format: 'wav', range: RANGE });
	const codes = inventoryDeliveryConversions(plan, source).map(({ code }) => code);
	assert.ok(codes.includes('delivery.quantize'), 'writing int24 from a float render is a conversion');
	assert.ok(codes.includes('delivery.lossless-encode'));
	assert.ok(
		codes.includes('delivery.dither'),
		'integer sample formats enable triangular dither by default, so every such delivery reports it',
	);
	assert.ok(!codes.includes('delivery.resample'), 'no rate change means no resample item');
	assert.ok(!codes.includes('delivery.lossy-encode'));
});

test('a rate change and a channel fold are each inventoried', () => {
	const plan = createExportPlan(audioProject(), {
		format: 'wav',
		sampleRate: 44_100,
		channelMapping: 'mono',
		range: RANGE,
	});
	const inventory = inventoryDeliveryConversions(plan, source);
	const resample = inventory.find(({ code }) => code === 'delivery.resample');
	const channelMap = inventory.find(({ code }) => code === 'delivery.channel-map');
	assert.ok(resample, 'a 48k render written at 44.1k is a conversion');
	assert.deepEqual(resample.data, { fromSampleRate: 48_000, toSampleRate: 44_100 });
	assert.ok(channelMap, 'folding stereo to mono is a conversion');
	assert.equal(channelMap.data.mode, 'mono');
	assert.equal(channelMap.data.toChannelCount, 1);
});

test('a lossy format is reported as a conversion and warns', () => {
	const plan = createExportPlan(audioProject(), { format: 'mp3', range: RANGE });
	const lossy = inventoryDeliveryConversions(plan, source)
		.find(({ code }) => code === 'delivery.lossy-encode');
	assert.ok(lossy);
	assert.equal(lossy.disposition, 'converted');
	assert.equal(lossy.severity, 'warning');
});

test('a report generated from the plan leaves nothing unreported', () => {
	for (const options of [
		{ format: 'wav', range: RANGE },
		{ format: 'mp3', range: RANGE },
		{ format: 'flac', sampleRate: 44_100, range: RANGE },
		{ format: 'wav', channelMapping: 'mono', dither: 'triangular', range: RANGE },
	]) {
		const plan = createExportPlan(audioProject(), options);
		const report = createDeliveryReportForPlan(plan, source);
		assert.equal(
			countUnreportedDeliveryConversions(plan, source, report),
			0,
			`a plan-derived report must report every conversion for ${JSON.stringify(options)}`,
		);
	}
});

test('a deliberately injected unreported conversion trips the collector', () => {
	const plan = createExportPlan(audioProject(), { format: 'wav', sampleRate: 44_100, range: RANGE });
	const complete = createDeliveryReportForPlan(plan, source);
	assert.equal(countUnreportedDeliveryConversions(plan, source, complete), 0);

	// Hand-assemble the same report with the resample quietly dropped — the exact
	// shape of hidden conversion the delivery gate exists to catch.
	const tampered = {
		...complete,
		items: complete.items.filter(({ code }) => code !== 'delivery.resample'),
	};
	assert.equal(
		countUnreportedDeliveryConversions(plan, source, tampered),
		1,
		'dropping a performed conversion from the report must be visible to the collector',
	);

	// Resample, quantization, and the dither that integer sample formats turn on
	// by default: an empty report hides all three.
	assert.equal(countUnreportedDeliveryConversions(plan, source, { items: [] }), 3);
	assert.equal(countUnreportedDeliveryConversions(plan, source, null), 3);
});

test('preservation is not counted as an unreported conversion', () => {
	const plan = createExportPlan(audioProject(), { format: 'wav', range: RANGE });
	const withoutPreservation = {
		items: inventoryDeliveryConversions(plan, source)
			.filter(({ disposition }) => disposition !== 'preserved')
			.map(({ code }) => ({ code })),
	};
	assert.equal(
		countUnreportedDeliveryConversions(plan, source, withoutPreservation),
		0,
		'only conversions and omissions are gated; preservation items are context',
	);
});

test('report emission does not mutate the project or the plan', () => {
	const project = audioProject();
	const before = JSON.stringify(project);
	const plan = createExportPlan(project, { format: 'mp3', channelMapping: 'mono', range: RANGE });
	const planBefore = JSON.stringify(plan);
	createDeliveryReportForPlan(plan, source);
	assert.equal(JSON.stringify(project), before, 'a report may never write back to the project');
	assert.equal(JSON.stringify(plan), planBefore, 'a report may never rewrite the plan it describes');
});

test('a sealed report rejects late appends and unknown dispositions', () => {
	const draft = createDeliveryReport({ format: 'wav' });
	addDeliveryReportItem(draft, { code: 'delivery.quantize', disposition: 'converted' });
	assert.throws(
		() => addDeliveryReportItem(draft, { code: 'x', disposition: 'invented' as never }),
		/Unsupported delivery disposition/u,
	);
	const sealed = sealDeliveryReport(draft);
	assert.equal(sealed.counts.converted, 1);
	assert.throws(() => addDeliveryReportItem(sealed as never, {
		code: 'delivery.dither', disposition: 'converted',
	}), /draft is required/u);
	assert.ok(Object.isFrozen(sealed.items));
});

test('ADM passthrough reports byte preservation and never a conversion', () => {
	const passthroughPlan = {
		format: 'bw64',
		sampleRate: 48_000,
		ditherMode: 'none',
		encoding: { channelCount: 2, inputChannelCount: 2 },
		adm: { metadata: { mode: 'passthrough' } },
	};
	const inventory = inventoryDeliveryConversions(passthroughPlan, source);
	assert.deepEqual(inventory.map(({ code }) => code), ['delivery.adm-passthrough']);
	assert.equal(inventory[0].disposition, 'preserved');
	assert.equal(
		countUnreportedDeliveryConversions(passthroughPlan, source, { items: [] }),
		0,
		'passthrough converts nothing, so nothing can go unreported',
	);
});

test('markers a format cannot carry are reported as omitted, not silently dropped', () => {
	// The interchange report describes marker selection and clipping, which happens
	// long before the writer is chosen. A format with no cue chunk drops what
	// survived that, so without this the delivery reports markers it never wrote.
	const markedPlan = (format: string) => ({
		format,
		sampleRate: 48_000,
		ditherMode: 'none',
		encoding: { channelCount: 2, inputChannelCount: 2, sampleFormat: 'float32', floatingPoint: true },
		markers: [{ id: 1, sampleOffset: 0, sampleLength: 0, label: 'Intro', note: '' }],
	});

	const omitted = inventoryDeliveryConversions(markedPlan('mp3'), source)
		.find(({ code }) => code === 'delivery.markers-omitted');
	assert.equal(omitted?.disposition, 'omitted');
	assert.equal(omitted?.severity, 'warning');
	assert.deepEqual(omitted?.data, { markers: 1, format: 'mp3' });
	assert.equal(
		countUnreportedDeliveryConversions(markedPlan('mp3'), source, { items: [] }) > 0,
		true,
		'and a report that never mentioned it would not pass the gate',
	);

	for (const format of ['wav', 'bwf', 'bw64']) {
		assert.equal(
			inventoryDeliveryConversions(markedPlan(format), source)
				.some(({ code }) => code === 'delivery.markers-omitted'),
			false,
			`${format} writes a cue chunk, so nothing is omitted`,
		);
	}
	assert.equal(
		inventoryDeliveryConversions({ ...markedPlan('mp3'), markers: [] }, source)
			.some(({ code }) => code === 'delivery.markers-omitted'),
		false,
		'a delivery with no markers omits nothing',
	);
});

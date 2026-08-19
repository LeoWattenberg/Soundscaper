/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createVideoDeliveryReportForPlan,
	inventoryVideoDeliveryConversions,
} from '../src/common/editor/delivery-video-conversion-inventory.ts';
import { countUnreportedDeliveryConversions } from '../src/common/editor/delivery-conversion-inventory.ts';

function videoPlan(overrides: Record<string, unknown> = {}) {
	return {
		version: 6,
		format: 'mp4',
		canvas: { width: 1_280, height: 720, frameRate: 30, pixelFormat: 'yuv420p' },
		codecs: { video: 'h264', videoEncoder: 'libx264', audio: 'aac', audioEncoder: 'aac' },
		inputs: [
			{ inputIndex: 0, kind: 'video-source', sourceId: 'a' },
			{ inputIndex: 1, kind: 'staged-audio-mix' },
		],
		...overrides,
	};
}

test('a video delivery reports its transcode, canvas, and audio codec', () => {
	const codes = inventoryVideoDeliveryConversions(videoPlan()).map(({ code }) => code);
	assert.ok(codes.includes('delivery.video-transcode'));
	assert.ok(codes.includes('delivery.audio-transcode'));
	assert.ok(codes.includes('delivery.canvas'));
});

test('stripped subtitle and data streams are reported on every video delivery', () => {
	const quiet = inventoryVideoDeliveryConversions(videoPlan())
		.find(({ code }) => code === 'delivery.streams-stripped');
	assert.ok(quiet, 'the encoder always passes -sn and -dn, so the omission always applies');
	assert.equal(quiet.disposition, 'omitted');
	assert.equal(quiet.severity, 'info', 'nothing was lost when no source carried such streams');
	assert.equal(quiet.data.carriedBySource, false);

	const lossy = inventoryVideoDeliveryConversions(videoPlan(), { hasNonMediaStreams: true })
		.find(({ code }) => code === 'delivery.streams-stripped');
	assert.ok(lossy);
	assert.equal(lossy.severity, 'warning', 'a source that carried them lost them');
	assert.equal(lossy.data.carriedBySource, true);
});

test('a muted video delivery reports the omitted audio rather than staying silent', () => {
	const muted = videoPlan({
		codecs: { video: 'h264', videoEncoder: 'libx264', audio: null, audioEncoder: null },
	});
	const codes = inventoryVideoDeliveryConversions(muted).map(({ code }) => code);
	assert.ok(codes.includes('delivery.audio-omitted'));
	assert.ok(!codes.includes('delivery.audio-transcode'));
});

test('every video delivery says which encoder produced it, and why when it fell back', () => {
	const accelerated = inventoryVideoDeliveryConversions(videoPlan(), {
		videoEncoder: 'webcodecs', videoEncoderCodec: 'avc1.4d0028',
	}).find(({ code }) => code === 'delivery.encoder');
	assert.ok(accelerated, 'a delivery that used the browser encoder must say so');
	assert.deepEqual(accelerated.data, {
		encoder: 'webcodecs', codec: 'avc1.4d0028', reason: null,
	});

	const fellBack = inventoryVideoDeliveryConversions(videoPlan(), {
		videoEncoder: 'ffmpeg', videoEncoderReason: 'This browser does not encode avc1.4d0028.',
	}).find(({ code }) => code === 'delivery.encoder');
	// A fallback with no reason is the reporting gap this item exists to close.
	assert.equal(fellBack?.data.reason, 'This browser does not encode avc1.4d0028.');
	assert.equal(fellBack?.data.codec, null);

	// Nothing is claimed when nothing was decided.
	assert.equal(
		inventoryVideoDeliveryConversions(videoPlan())
			.some(({ code }) => code === 'delivery.encoder'),
		false,
	);
});

test('a plan-derived video report leaves nothing unreported', () => {
	for (const plan of [videoPlan(), videoPlan({ format: 'webm' })]) {
		const report = createVideoDeliveryReportForPlan(plan);
		const inventory = inventoryVideoDeliveryConversions(plan);
		const reported = new Set(report.items.map(({ code }) => code));
		for (const conversion of inventory) {
			assert.ok(reported.has(conversion.code), `${conversion.code} must appear in the report`);
		}
		assert.equal(report.format, 'delivery');
		assert.equal(report.subject.lossless, false, 'no shipping video format is lossless');
	}
});

test('the video report speaks the same vocabulary the audio collector counts', () => {
	const plan = videoPlan();
	const report = createVideoDeliveryReportForPlan(plan);
	// The audio collector's counter walks items by code, so a video report is a
	// valid input to it and a tampered one is just as visible.
	const tampered = {
		items: report.items.filter(({ code }) => code !== 'delivery.video-transcode'),
	};
	const missing = inventoryVideoDeliveryConversions(plan)
		.filter(({ disposition }) => disposition === 'converted' || disposition === 'omitted')
		.filter(({ code }) => !tampered.items.some((item) => item.code === code));
	assert.deepEqual(missing.map(({ code }) => code), ['delivery.video-transcode']);
	assert.equal(countUnreportedDeliveryConversions(
		{ format: 'wav', sampleRate: 48_000, encoding: {}, ditherMode: 'none' },
		{ sampleRate: 48_000 },
		report,
	), 0);
});

test('a keyed delivery reports the frame rate its rational states', () => {
	// The graph plan states a decimal and the keyed plan a reduced rational, so
	// reading only the decimal left every keyed delivery — the ones whose whole
	// stop condition is that the exact rational survives — reporting no rate.
	const report = createVideoDeliveryReportForPlan({
		format: 'mp4',
		canvas: { width: 1_280, height: 720, frameRate: { num: 30_000, den: 1_001 } },
		codecs: { video: 'h264', videoEncoder: 'libx264' },
		captions: null,
		inputs: [],
	});
	const canvas = report.items.find(({ code }) => code === 'delivery.canvas');

	assert.equal(canvas?.data.frameRate, 30_000 / 1_001);
	assert.equal(report.subject.sampleRate, 30_000 / 1_001);
});

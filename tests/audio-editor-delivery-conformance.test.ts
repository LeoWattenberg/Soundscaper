/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createExportPlan } from '../src/common/editor/export.js';
import { encodeWav } from '../src/common/editor/wav.js';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';
import {
	CONFORMANCE_READABLE_FORMATS,
	DeliveryConformanceError,
	assertDeliveryConformance,
	conformDeliveredAudio,
} from '../src/common/editor/delivery-conformance.ts';

/** A Blob-shaped view of produced bytes, so the ordinary reader reopens them unchanged. */
function bytesSource(bytes: Uint8Array) {
	return {
		size: bytes.byteLength,
		slice: (start: number, end: number) => ({
			arrayBuffer: async () => bytes.slice(start, end).buffer,
		}),
	};
}

const inspect = (source: never) => inspectWavBlobPcm(source);

const PROJECT = {
	id: 'conformance', title: 'Conformance', sampleRate: 48_000, masterChannels: 2,
	selection: { startFrame: 0, endFrame: 0 }, loop: { enabled: false, startFrame: 0, endFrame: 0 },
	sources: [], clips: [],
	tracks: [{
		type: 'audio', id: 't', name: 'A', clipIds: [], mute: false, solo: false,
		hidden: false, collapsed: false, height: 120, laneGroupId: null,
	}],
};

function deliver(options: Record<string, unknown> = {}, frames = 480) {
	const plan = createExportPlan(PROJECT, {
		format: 'wav', sampleFormat: 'int24', bitDepth: 24,
		range: { startFrame: 0, endFrame: frames }, includeTail: false, ...options,
	});
	const channels = Array.from({ length: plan.channelCount }, () => new Float32Array(plan.outputFrames));
	const bytes = encodeWav(channels, {
		sampleRate: plan.sampleRate,
		bitDepth: (plan.encoding.bitDepth ?? 24) as 24,
		float: plan.encoding.floatingPoint,
		dither: 'none',
		markers: plan.markers,
		...(plan.bext ? { bext: plan.bext } : {}),
	});
	return { plan, bytes };
}

test('a conforming master reports every check it passed', async () => {
	// A delivery that conformed should say which checks it passed rather than
	// saying nothing at all.
	const { plan, bytes } = deliver();
	const findings = await conformDeliveredAudio(plan as never, bytesSource(bytes), { inspect: inspect as never });

	assert.deepEqual(findings.map(({ code }) => code), [
		'delivery.conformance-duration',
		'delivery.conformance-channel-count',
		'delivery.conformance-sample-rate',
		'delivery.conformance-sample-format',
		'delivery.conformance-channel-map',
	]);
	assert.ok(findings.every(({ severity }) => severity === 'info'));
	assert.ok(findings.every(({ disposition }) => disposition === 'preserved'));
	assert.equal(findings[0].data.errorSamples, 0, 'the exit gate reads this as delivery.audioDurationErrorSamples');
	assert.equal(
		findings.find(({ code }) => code === 'delivery.conformance-channel-map')?.data.channelMapErrors,
		0,
	);
	assert.doesNotThrow(() => assertDeliveryConformance(findings));
});

test('a corrupted master fails its reopen check and the report says why', async () => {
	const { plan, bytes } = deliver();
	// Truncate the audio without touching the header: the file still parses, and
	// still claims a duration it does not have.
	const truncated = bytes.subarray(0, bytes.byteLength - 300);
	const findings = await conformDeliveredAudio(plan as never, bytesSource(truncated), { inspect: inspect as never });

	const failure = findings.find(({ severity }) => severity === 'error');
	assert.ok(failure, 'a truncated master must not conform');
	assert.match(failure.message, /could not be reopened|not the planned/u);

	assert.throws(() => assertDeliveryConformance(findings), (error: unknown) => {
		assert.ok(error instanceof DeliveryConformanceError);
		assert.ok(error.findings.length > 0, 'the failure carries the findings so the report can say why');
		return true;
	});
});

test('a header that lies about its own duration is caught by reading the bytes back', async () => {
	// The writer is never trusted: the plan says one length and the file says
	// another, and only reopening it can tell.
	const { plan, bytes } = deliver();
	const findings = await conformDeliveredAudio(
		{ ...plan, outputFrames: plan.outputFrames + 7 } as never,
		bytesSource(bytes),
		{ inspect: inspect as never },
	);
	const duration = findings.find(({ code }) => code === 'delivery.conformance-duration');
	assert.equal(duration?.severity, 'error');
	assert.equal(duration?.data.errorSamples, 7);
	assert.equal(duration?.data.actual, plan.outputFrames);
});

test('a channel count or rate the file does not have is a failed delivery', async () => {
	const { plan, bytes } = deliver();
	for (const [field, override, code] of [
		['channelCount', 5, 'delivery.conformance-channel-count'],
		['sampleRate', 96_000, 'delivery.conformance-sample-rate'],
	] as const) {
		const findings = await conformDeliveredAudio(
			{ ...plan, [field]: override } as never, bytesSource(bytes), { inspect: inspect as never },
		);
		assert.equal(findings.find((finding) => finding.code === code)?.severity, 'error', field);
		assert.throws(() => assertDeliveryConformance(findings), DeliveryConformanceError);
	}
});

test('cues are conformed against the file, not against the writer that wrote them', async () => {
	const { plan, bytes } = deliver();
	const planWithMarkers = { ...plan, markers: [{ sampleOffset: 0 }, { sampleOffset: 240 }] };
	const findings = await conformDeliveredAudio(planWithMarkers as never, bytesSource(bytes), {
		inspect: inspect as never,
	});
	const markers = findings.find(({ code }) => code === 'delivery.conformance-markers');
	assert.equal(markers?.severity, 'error', 'the file carries no cues, so the claim fails');
	assert.deepEqual(markers?.data, { expected: 2, actual: 0 });
});

test('a file that cannot be reopened at all is the most severe outcome there is', async () => {
	const { plan } = deliver();
	const findings = await conformDeliveredAudio(plan as never, bytesSource(new Uint8Array(4)), {
		inspect: inspect as never,
	});
	assert.deepEqual(findings.map(({ code }) => code), ['delivery.conformance-unreadable']);
	assert.equal(findings[0].severity, 'error');
	assert.match(String(findings[0].data.reason), /RIFF|small/u);
});

test('a format with no reader is reported unverified rather than assumed good', async () => {
	const findings = await conformDeliveredAudio(
		{ format: 'mp3', outputFrames: 1, sampleRate: 48_000, channelCount: 2 } as never,
		bytesSource(new Uint8Array(8)),
		{ inspect: inspect as never },
	);
	assert.deepEqual(findings.map(({ code }) => code), ['delivery.conformance-unverified']);
	assert.equal(findings[0].disposition, 'omitted');
	assert.equal(findings[0].severity, 'warning');
	assert.doesNotThrow(() => assertDeliveryConformance(findings), 'unverified is not a failure, it is unverified');
	assert.deepEqual([...CONFORMANCE_READABLE_FORMATS], ['wav', 'bwf', 'bw64']);
});

test('broadcast metadata is conformed by reopening it, and its absence is a failure', async () => {
	const { plan, bytes } = deliver({ format: 'bwf', bext: { description: 'Reference master' } });
	const findings = await conformDeliveredAudio(plan as never, bytesSource(bytes), { inspect: inspect as never });
	const bext = findings.find(({ code }) => code === 'delivery.conformance-bext');
	assert.equal(bext?.severity, 'info');
	assert.equal(bext?.data.present, true);

	// The same plan against a file written without the metadata it promised.
	const withoutBext = deliver({ format: 'wav' }).bytes;
	const missing = await conformDeliveredAudio(plan as never, bytesSource(withoutBext), {
		inspect: inspect as never,
	});
	const absent = missing.find(({ code }) => code === 'delivery.conformance-bext');
	assert.equal(absent?.severity, 'error');
	assert.match(absent?.message ?? '', /carries no broadcast metadata/u);
});

test('the loudness stamped in the file must be the loudness that was measured', async () => {
	// A disagreement sends every downstream check to the wrong value, so the
	// disagreement itself is the finding.
	const { plan, bytes } = deliver({ format: 'bwf', bext: { description: 'Master', loudnessValue: -23 } });
	const conformed = await conformDeliveredAudio(plan as never, bytesSource(bytes), {
		inspect: inspect as never,
		deliveredLoudness: { loudnessValue: -23 },
	});
	assert.equal(conformed.find(({ code }) => code === 'delivery.conformance-loudness')?.severity, 'info');

	const mismatched = await conformDeliveredAudio(plan as never, bytesSource(bytes), {
		inspect: inspect as never,
		deliveredLoudness: { loudnessValue: -18 },
	});
	const finding = mismatched.find(({ code }) => code === 'delivery.conformance-loudness');
	assert.equal(finding?.severity, 'error');
	assert.deepEqual(finding?.data.mismatched, ['loudnessValue']);
});

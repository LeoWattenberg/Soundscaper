/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	SoundscaperDeliveryContractError,
	assertSoundscaperDeliveryCurrentV1,
	createSoundscaperDeliveryDescriptionV1,
	fingerprintSoundscaperDeliveryPlanV1,
	sealSoundscaperDeliveryReportV1,
	validateSoundscaperDeliveryDescriptionV1,
	validateSoundscaperDeliveryResultV1,
} from '../src/common/editor/soundscaper-delivery-contract-v1.ts';

const PROJECT = Object.freeze({
	projectId: 'album-project',
	projectRevision: 17,
	projectSha256: 'a'.repeat(64),
});

function deliveryReport() {
	return {
		schemaVersion: 1,
		format: 'delivery',
		direction: 'export',
		subject: {
			format: 'wav', container: 'riff', codec: 'pcm-s24le',
			sampleRate: 48_000, channelCount: 2, lossless: true,
		},
		items: [{
			code: 'delivery.sample-format', severity: 'info', disposition: 'preserved',
			scope: { kind: 'mix' }, data: { bitDepth: 24 },
		}],
		counts: { preserved: 1, converted: 0, missing: 0, omitted: 0 },
	};
}

function description() {
	return createSoundscaperDeliveryDescriptionV1({
		label: 'Album master',
		projectIdentity: PROJECT,
		plan: {
			format: 'wav',
			encoding: { sampleRate: 48_000, sampleFormat: 's24' },
			outputFrames: 172_800_000,
		},
		destinationGrantId: 'delivery-grant-01',
	});
}

test('a delivery description snapshots one exact canonical plan and project witness', () => {
	const plan = {
		format: 'wav',
		encoding: { sampleRate: 48_000, sampleFormat: 's24' },
		outputFrames: 172_800_000,
	};
	const expected = fingerprintSoundscaperDeliveryPlanV1(plan);
	const value = createSoundscaperDeliveryDescriptionV1({
		label: 'Album master', projectIdentity: PROJECT, plan,
		destinationGrantId: 'delivery-grant-01',
	});

	plan.encoding.sampleRate = 44_100;
	assert.deepEqual(value, {
		kind: 'soundscaper-delivery',
		version: 1,
		label: 'Album master',
		projectIdentity: PROJECT,
		planPayload: expected.canonical,
		planFingerprint: expected.sha256,
		destinationGrantId: 'delivery-grant-01',
		recoveryClass: 'atomic-restart',
	});
	assert.equal(Object.isFrozen(value), true);
	assert.equal(Object.isFrozen(value.projectIdentity), true);
	assert.equal(Object.isFrozen(JSON.parse(value.planPayload)), false, 'the stored plan is data, not live object identity');
});

test('description validation refuses drifted plans, fingerprints, authority and open fields', () => {
	const value = description();
	assert.deepEqual(validateSoundscaperDeliveryDescriptionV1(value), value);
	assert.throws(
		() => validateSoundscaperDeliveryDescriptionV1({ ...value, planPayload: '{"format":"flac"}' }),
		(error: unknown) => error instanceof SoundscaperDeliveryContractError && error.code === 'stale-plan',
	);
	assert.throws(
		() => validateSoundscaperDeliveryDescriptionV1({
			...value, projectIdentity: { ...PROJECT, projectSha256: 'not-a-digest' },
		}),
		/sha256/iu,
	);
	assert.throws(
		() => validateSoundscaperDeliveryDescriptionV1({ ...value, mediaBytes: [1, 2, 3] }),
		/unsupported fields/iu,
	);
	assert.throws(
		() => validateSoundscaperDeliveryDescriptionV1({ ...value, planVersion: 29 }),
		/unsupported fields/iu,
	);
	assert.throws(
		() => createSoundscaperDeliveryDescriptionV1({
			label: 'Checkpoint lie', projectIdentity: PROJECT,
			plan: { format: 'wav' }, destinationGrantId: 'delivery-grant-01',
			recoveryClass: 'verified-frame-checkpoint' as never,
		}),
		/atomic restart/iu,
	);
});

test('currentness requires exact project identity and the same re-derived plan fingerprint', () => {
	const value = description();
	assert.doesNotThrow(() => assertSoundscaperDeliveryCurrentV1(value, {
		projectIdentity: PROJECT,
		planFingerprint: value.planFingerprint,
	}));
	for (const projectIdentity of [
		{ ...PROJECT, projectId: 'another-project' },
		{ ...PROJECT, projectRevision: PROJECT.projectRevision + 1 },
		{ ...PROJECT, projectSha256: 'b'.repeat(64) },
	]) {
		assert.throws(
			() => assertSoundscaperDeliveryCurrentV1(value, {
				projectIdentity, planFingerprint: value.planFingerprint,
			}),
			(error: unknown) => error instanceof SoundscaperDeliveryContractError
				&& error.code === 'stale-project',
		);
	}
	assert.throws(
		() => assertSoundscaperDeliveryCurrentV1(value, {
			projectIdentity: PROJECT, planFingerprint: 'b'.repeat(64),
		}),
		(error: unknown) => error instanceof SoundscaperDeliveryContractError
			&& error.code === 'stale-plan',
	);
});

test('a result is closed, report-sealed, bounded, and bound to its description', () => {
	const expected = description();
	const report = deliveryReport();
	const result = validateSoundscaperDeliveryResultV1({
		kind: 'soundscaper-delivery-result',
		version: 1,
		projectIdentity: PROJECT,
		planFingerprint: expected.planFingerprint,
		publication: {
			fileName: 'Album-master.wav',
			byteLength: 864_000_044,
			sha256: 'c'.repeat(64),
		},
		report,
	}, expected);

	report.items[0]!.data.bitDepth = 16;
	assert.equal(result.report.items[0]?.data.bitDepth, 24);
	assert.equal(Object.isFrozen(result), true);
	assert.equal(Object.isFrozen(result.report), true);
	assert.equal(Object.isFrozen(result.report.items), true);
	assert.equal(Object.isFrozen(result.report.items[0]?.data), true);
	assert.equal(result.report.counts.preserved, 1);
});

test('result validation rejects mismatched witnesses and dishonest report counts', () => {
	const expected = description();
	const base = {
		kind: 'soundscaper-delivery-result', version: 1,
		projectIdentity: PROJECT, planFingerprint: expected.planFingerprint,
		publication: { fileName: 'master.wav', byteLength: 44, sha256: 'c'.repeat(64) },
		report: deliveryReport(),
	};
	assert.throws(
		() => validateSoundscaperDeliveryResultV1({
			...base, projectIdentity: { ...PROJECT, projectRevision: 18 },
		}, expected),
		(error: unknown) => error instanceof SoundscaperDeliveryContractError
			&& error.code === 'stale-project',
	);
	assert.throws(
		() => validateSoundscaperDeliveryResultV1({ ...base, planFingerprint: 'd'.repeat(64) }, expected),
		(error: unknown) => error instanceof SoundscaperDeliveryContractError
			&& error.code === 'stale-plan',
	);
	assert.throws(
		() => validateSoundscaperDeliveryResultV1({
			...base, report: { ...deliveryReport(), counts: { preserved: 0, converted: 0, missing: 0, omitted: 0 } },
		}, expected),
		/report counts/iu,
	);
	assert.throws(
		() => validateSoundscaperDeliveryResultV1({
			...base, publication: { ...base.publication, fileName: '../master.wav' },
		}, expected),
		/file name/iu,
	);
});

test('report validation preflights depth, nodes and string bytes before serialization', () => {
	let deep: unknown = null;
	for (let depth = 0; depth < 50; depth += 1) deep = { nested: deep };
	for (const [data, message] of [
		[{ values: Array.from({ length: 9_000 }, () => null) }, /structural node budget/iu],
		[deep, /structural depth budget/iu],
		[{ value: 'é'.repeat(33_000) }, /structural string-byte budget/iu],
	] as const) {
		const report = deliveryReport();
		(report.items[0] as unknown as { data: unknown }).data = data;
		assert.throws(
			() => sealSoundscaperDeliveryReportV1(report),
			(error: unknown) => error instanceof SoundscaperDeliveryContractError
				&& error.code === 'oversized' && message.test(error.message),
		);
	}
});

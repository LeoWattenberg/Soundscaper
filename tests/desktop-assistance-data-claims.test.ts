/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ASSISTANCE_DATA_CLAIM_VERSION,
	validateAssistanceOutputClaim,
	validateAssistanceOutputReservation,
	validateAssistanceStagedInputClaim,
} from '../desktop/assistance-data-claims.ts';

const JOB_ID = 'ab'.repeat(20);
const CLAIM_ID = 'cd'.repeat(20);
const SHA256 = 'ef'.repeat(32);

const INPUT = Object.freeze({
	claimVersion: ASSISTANCE_DATA_CLAIM_VERSION,
	claimId: CLAIM_ID,
	jobId: JOB_ID,
	role: 'audio' as const,
	mediaType: 'audio/wav',
	byteLength: 38_400_000,
	sha256: SHA256,
});

const RESERVATION = Object.freeze({
	claimVersion: ASSISTANCE_DATA_CLAIM_VERSION,
	claimId: CLAIM_ID,
	jobId: JOB_ID,
	role: 'transcript' as const,
	mediaType: 'application/vnd.soundscaper.transcript+json',
	maximumByteLength: 64 * 1024 * 1024,
});

test('staged assistance claims are pathless, digest-bound, and closed', () => {
	assert.deepEqual(validateAssistanceStagedInputClaim(INPUT), INPUT);
	assert.throws(
		() => validateAssistanceStagedInputClaim({ ...INPUT, path: '/private/source.wav' }),
		/exactly|schema keys/iu,
	);
	assert.throws(
		() => validateAssistanceStagedInputClaim({ ...INPUT, sha256: 'not-a-digest' }),
		/SHA-256/iu,
	);
	assert.throws(
		() => validateAssistanceStagedInputClaim({ ...INPUT, byteLength: 0 }),
		/byte length/iu,
	);
});

test('an output reservation becomes a claim only with its exact identity and digest', () => {
	assert.deepEqual(validateAssistanceOutputReservation(RESERVATION), RESERVATION);
	const claim = {
		claimVersion: ASSISTANCE_DATA_CLAIM_VERSION,
		claimId: CLAIM_ID,
		jobId: JOB_ID,
		role: 'transcript',
		mediaType: RESERVATION.mediaType,
		byteLength: 1_024,
		sha256: SHA256,
	};
	assert.deepEqual(validateAssistanceOutputClaim(claim, RESERVATION), claim);
	assert.throws(
		() => validateAssistanceOutputClaim({ ...claim, claimId: '12'.repeat(20) }, RESERVATION),
		/reservation/iu,
	);
	assert.throws(
		() => validateAssistanceOutputClaim({ ...claim, byteLength: RESERVATION.maximumByteLength + 1 }, RESERVATION),
		/maximum|reservation/iu,
	);
});

test('claim ids, job ids, roles, and media types are admitted from closed vocabularies', () => {
	for (const candidate of [
		{ ...INPUT, jobId: 'job-1' },
		{ ...INPUT, claimId: 'claim-1' },
		{ ...INPUT, role: 'filesystem-path' },
		{ ...INPUT, mediaType: '../audio' },
	]) {
		assert.throws(() => validateAssistanceStagedInputClaim(candidate), /id|role|media type/iu);
	}
	assert.throws(
		() => validateAssistanceOutputReservation({ ...RESERVATION, role: 'arbitrary-result' }),
		/output role/iu,
	);
	assert.throws(
		() => validateAssistanceStagedInputClaim({ ...INPUT, mediaType: 'application/json' }),
		/audio.*media type/iu,
	);
	assert.throws(
		() => validateAssistanceOutputReservation({ ...RESERVATION, mediaType: 'audio/wav' }),
		/transcript.*media type/iu,
	);
	assert.deepEqual(validateAssistanceStagedInputClaim({
		...INPUT,
		role: 'frame-pack',
		mediaType: 'application/vnd.soundscaper.frame-pack',
	}), {
		...INPUT,
		role: 'frame-pack',
		mediaType: 'application/vnd.soundscaper.frame-pack',
	});
	assert.deepEqual(validateAssistanceOutputReservation({
		...RESERVATION,
		role: 'enhanced-audio',
		mediaType: 'audio/wav',
	}), {
		...RESERVATION,
		role: 'enhanced-audio',
		mediaType: 'audio/wav',
	});
	assert.deepEqual(validateAssistanceOutputReservation({
		...RESERVATION,
		role: 'embeddings',
		mediaType: 'application/vnd.soundscaper.embedding-matrix-v1',
	}), {
		...RESERVATION,
		role: 'embeddings',
		mediaType: 'application/vnd.soundscaper.embedding-matrix-v1',
	});
	assert.throws(() => validateAssistanceOutputReservation({
		...RESERVATION,
		role: 'embeddings',
		mediaType: 'application/vnd.soundscaper.embeddings+json',
	}), /embeddings.*media type/iu);
});

test('highlight signal claims admit only their strict normalized JSON formats', () => {
	for (const role of [
		'highlight-video-signals',
		'highlight-audio-signals',
		'highlight-transcript-signals',
	] as const) {
		const mediaType = `application/vnd.soundscaper.${role}+json`;
		assert.equal(validateAssistanceStagedInputClaim({
			...INPUT, role, mediaType,
		}).mediaType, mediaType);
		assert.throws(() => validateAssistanceStagedInputClaim({
			...INPUT, role, mediaType: 'application/json',
		}), new RegExp(`${role}.*media type`, 'iu'));
	}
});

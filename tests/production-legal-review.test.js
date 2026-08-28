/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const checklistUrl = new URL('../docs/legalchecklist.md', import.meta.url);
const reviewUrl = new URL('../config/production-legal-review.json', import.meta.url);
const matrixUrl = new URL('../config/production-licensing-matrix.json', import.meta.url);

const OPEN_RELEASE_ITEMS = Object.freeze([
	'web-legal-notices-content-placement',
	'web-notice-engineering-gate',
	'web-versioned-runtime-notice-delivery',
]);

const DEFERRED_ITEMS = Object.freeze([
	'android-google-play-review',
	'externally-authored-web-effects-review',
	'legacy-web-ffmpeg-reactivation-review',
	'lightscaper-third-party-assets-review',
	'refused-model-exclusion-review',
]);

async function readJson(url) {
	return JSON.parse(await readFile(url, 'utf8'));
}

test('the legal review is bound to the owner-completed checklist', async () => {
	const [checklistBytes, review] = await Promise.all([
		readFile(checklistUrl),
		readJson(reviewUrl),
	]);
	const checklist = checklistBytes.toString('utf8');
	const checked = checklist.match(/^- \[x\]/gimu) ?? [];
	const unchecked = checklist.match(/^- \[ \]/gimu) ?? [];

	assert.equal(review.schemaVersion, 1);
	assert.equal(review.status, 'approved-with-open-items');
	assert.equal(review.reviewer.organization, 'kw.media');
	assert.equal(review.reviewer.capacity, 'owner-and-sole-contributor');
	assert.equal(review.reviewer.legalInformationUrl, 'https://kw.media/impressum/');
	assert.equal(review.reviewedAt, '2026-08-28');
	assert.equal(review.approvalAuthority, 'repository-owner-record');
	assert.deepEqual(review.scope.products, ['soundscaper', 'framescaper']);
	assert.equal(review.scope.territories, 'global');
	assert.deepEqual(review.scope.distributionChannels, [
		'cloudflare-web-application-and-assets',
		'direct-electron-downloads',
	]);
	assert.deepEqual(review.scope.excludedDistributionChannels, ['application-stores']);

	assert.equal(review.checklist.path, 'docs/legalchecklist.md');
	assert.equal(review.checklist.sha256,
		createHash('sha256').update(checklistBytes).digest('hex'));
	assert.equal(review.checklist.satisfiedCount, checked.length);
	assert.equal(review.checklist.openCount, unchecked.length);
	assert.equal(review.checklist.satisfiedCount, 65);
	assert.equal(review.checklist.openCount, 8);
	assert.equal(review.checklist.checkedMeaning, 'satisfied');
	assert.equal(review.checklist.uncheckedMeaning, 'not-satisfied');
	assert.equal(review.checklist.commentPrefix, '--');
});

test('open and conditional decisions cannot be mistaken for blanket approval', async () => {
	const review = await readJson(reviewUrl);

	assert.deepEqual(review.openReleaseItems.map(({ id }) => id).sort(), OPEN_RELEASE_ITEMS);
	assert.ok(review.openReleaseItems.every(({ status }) => status === 'open'));
	assert.deepEqual(review.deferredItems.map(({ id }) => id).sort(), DEFERRED_ITEMS);
	assert.ok(review.deferredItems.every(({ status }) => status === 'not-satisfied'));

	assert.deepEqual(review.conditions.nativeMediaCodecExecution.allowedProviders, [
		'webcodecs', 'operating-system', 'user-installed-ffmpeg',
	]);
	assert.deepEqual(review.conditions.nativeMediaCodecExecution.disallowedDistribution, [
		'bundled-ffmpeg',
	]);
	assert.equal(review.conditions.nativeMediaCodecExecution.status, 'approved-with-conditions');
	assert.equal(review.conditions.independentNativeReadinessKey.required, false);
	assert.equal(review.conditions.independentNativeReadinessKey.replacement,
		'repository-owner-record');
});

test('the licensing matrix points at the legal review without clearing engineering gates', async () => {
	const matrix = await readJson(matrixUrl);
	assert.deepEqual(matrix.humanLegalReview, {
		status: 'approved-with-open-items',
		record: 'config/production-legal-review.json',
		reviewedAt: '2026-08-28',
		reviewer: 'kw.media owner and sole contributor',
	});

	const releaseGates = new Map(matrix.releaseGates.map((row) => [row.id, row]));
	for (const id of [
		'web-notice-delivery',
		'ffmpeg-enabled-library-corresponding-source',
		'ffmpeg-enabled-codec-patent-review',
	]) {
		assert.equal(releaseGates.get(id)?.status, 'blocked', id);
	}

	const nativeFfmpeg = matrix.nativeFormatPolicies.find(({ id }) =>
		id === 'codec-native-ffmpeg-current-set');
	assert.equal(nativeFfmpeg?.status, 'blocked');
	assert.match(nativeFfmpeg?.blocker ?? '', /does not approve bundled FFmpeg/iu);
});

test('accepted model risks are recorded while missing artifacts still block distribution', async () => {
	const matrix = await readJson(matrixUrl);
	const byId = new Map(matrix.localModelEvidence.map((record) => [record.id, record]));
	const reviewedIds = [
		'beat-this-final0',
		'beat-this-small0',
		'demucs-v4-htdemucs',
		'panns-cnn10',
		'qwen3-4b-q4-k-m',
		'spleeter',
		'tiger-dnr',
		'transnetv2',
		'wav2vec2-base-960h',
	];

	for (const id of reviewedIds) {
		const record = byId.get(id);
		assert.ok(record, `${id} needs a licensing-evidence row`);
		assert.equal(record.requirements['weights-and-code-license-review'].status,
			'recorded', id);
		assert.equal(record.requirements['versioned-download-notices-and-hashes'].status,
			'pending', id);
		assert.equal(record.distributionStatus, 'blocked', id);
		assert.deepEqual(record.blockedBy, ['versioned-download-notices-and-hashes'], id);
	}
});

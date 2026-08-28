/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	LOCAL_MODEL_REQUIREMENT_IDS,
	deriveBlockedBy,
	deriveDistributionStatus,
	validateLocalModelEvidence,
	validateRefusedLocalModels,
} from '../scripts/lib/local-model-evidence.mjs';

const matrixUrl = new URL('../config/production-licensing-matrix.json', import.meta.url);
const catalogUrl = new URL('../config/local-model-catalog.json', import.meta.url);
const noticesUrl = new URL('../THIRD_PARTY_LICENSES.md', import.meta.url);
const repositoryUrl = new URL('../', import.meta.url);

const LAUNCH_SET_IDS = [
	'deepfilternet3',
	'parakeet-tdt-0.6b-v2',
	'parakeet-tdt-0.6b-v3',
	'pyannote-segmentation-3.0',
	'silero-vad-v6',
	'speech-3d-speaker-eres2net',
	'spleeter',
	'whisper-large-v3-turbo-ggml',
];

const REFUSED_IDS = [
	'beats-audioset-checkpoints',
	'beatnet',
	'bs-roformer-community-checkpoints',
	'crisperwhisper',
	'essentia-models',
	'madmom-models',
	'mms-300m-1130-forced-aligner',
	'nvidia-canary-1b',
	'nvidia-sortformer-diarization',
	'open-unmix-umxhq',
	'ten-vad',
];

function requirementEntries(overrides = {}) {
	const entries = {};
	for (const id of LOCAL_MODEL_REQUIREMENT_IDS) {
		entries[id] = { status: 'recorded', summary: `Recorded evidence for ${id}.` };
	}
	return { ...entries, ...overrides };
}

function validRecord(overrides = {}) {
	const requirements = overrides.requirements ?? requirementEntries();
	const record = {
		id: 'example-model',
		purpose: 'Example task.',
		runtimeFormat: 'onnx',
		codeLicense: 'MIT',
		weightsLicense: 'MIT',
		attributionRequired: false,
		distributionStatus: 'permitted',
		blockedBy: [],
		requirements,
		provenanceSources: ['https://example.invalid/model'],
		evidence: ['docs/milestone-7-plan.md'],
		...overrides,
	};
	record.requirements = requirements;
	record.blockedBy = overrides.blockedBy ?? deriveBlockedBy(record);
	record.distributionStatus = overrides.distributionStatus ?? deriveDistributionStatus(record);
	return record;
}

function options(overrides = {}) {
	return {
		requirementIds: LOCAL_MODEL_REQUIREMENT_IDS,
		refusedIds: [],
		...overrides,
	};
}

function assertRefused(records, pattern, validatorOptions = options()) {
	assert.throws(() => validateLocalModelEvidence(records, validatorOptions), pattern);
}

test('the enabled local-models gate names the requirements every evidence record must answer', async () => {
	const matrix = await readJson(matrixUrl);
	const gate = matrix.futureDistributionGates.find(({ id }) => id === 'local-models');

	assert.ok(gate, 'the local-models gate must remain in the matrix');
	assert.equal(gate.status, 'enabled', 'the gate admits only records that satisfy every requirement');
	assert.deepEqual([...gate.enableRequires].sort(), [...LOCAL_MODEL_REQUIREMENT_IDS].sort());

	for (const record of matrix.localModelEvidence) {
		assert.deepEqual(
			Object.keys(record.requirements).sort(),
			[...gate.enableRequires].sort(),
			`${record.id} must answer exactly the requirements the gate names`,
		);
	}
});

test('checked-in local model evidence validates and covers the audio launch set', async () => {
	const matrix = await readJson(matrixUrl);
	const gate = matrix.futureDistributionGates.find(({ id }) => id === 'local-models');
	const refused = validateRefusedLocalModels(matrix.refusedLocalModels);

	validateLocalModelEvidence(matrix.localModelEvidence, {
		requirementIds: gate.enableRequires,
		refusedIds: refused.map(({ id }) => id),
	});

	const recordIds = matrix.localModelEvidence.map(({ id }) => id);
	assert.equal(new Set(recordIds).size, recordIds.length, 'record ids must be unique');
	for (const id of LAUNCH_SET_IDS) {
		assert.ok(recordIds.includes(id), `the audio launch set must record ${id}`);
	}

	for (const record of matrix.localModelEvidence) {
		await assertEvidence(record.evidence);
	}
});

test('a model is distributable exactly when its artifacts are mirrored', async () => {
	const matrix = await readJson(matrixUrl);
	const catalog = await readJson(catalogUrl);
	const mirrored = new Set(catalog.entries
		.filter((entry) => entry.artifacts !== null)
		.map(({ modelId }) => modelId));

	assert.ok(mirrored.size > 0, 'at least one model has been mirrored');

	for (const record of matrix.localModelEvidence) {
		if (mirrored.has(record.id)) {
			assert.equal(record.distributionStatus, 'permitted', `${record.id} is mirrored and reviewed`);
			assert.deepEqual(record.blockedBy, []);
			continue;
		}
		assert.equal(
			record.distributionStatus,
			'blocked',
			`${record.id} must stay blocked while nothing is mirrored for it`,
		);
		assert.ok(
			record.blockedBy.includes('versioned-download-notices-and-hashes'),
			`${record.id} cannot claim pinned download evidence before an artifact is mirrored`,
		);
	}
});

test('a distributable model cites the exact bytes it ships in the notices', async () => {
	const matrix = await readJson(matrixUrl);
	const catalog = await readJson(catalogUrl);
	const notices = await readFile(noticesUrl, 'utf8');
	const permitted = matrix.localModelEvidence
		.filter(({ distributionStatus }) => distributionStatus === 'permitted')
		.map(({ id }) => id);

	assert.ok(permitted.length > 0, 'at least one model has cleared its evidence');

	for (const modelId of permitted) {
		const entry = catalog.entries.find((candidate) => candidate.modelId === modelId);
		assert.ok(entry?.artifacts, `${modelId} claims distribution without a mirrored artifact`);
		for (const artifact of entry.artifacts) {
			// The digest, not the name: a notice that cites the shipped bytes
			// cannot drift onto a different build of the same model.
			assert.ok(
				notices.includes(artifact.sha256),
				`${modelId}: ${artifact.fileName} digest is missing from the offline notices`,
			);
		}
	}
});

test('owner-accepted upstream ambiguity is recorded without fabricating artifact evidence', async () => {
	const matrix = await readJson(matrixUrl);
	const byId = new Map(matrix.localModelEvidence.map((record) => [record.id, record]));

	for (const id of ['spleeter', 'demucs-v4-htdemucs', 'transnetv2']) {
		const record = byId.get(id);
		assert.ok(record, `${id} must be recorded rather than silently omitted`);
		assert.equal(record.requirements['weights-and-code-license-review'].status, 'recorded');
		assert.deepEqual(record.blockedBy, ['versioned-download-notices-and-hashes']);
		assert.equal(record.distributionStatus, 'blocked');
	}
});

test('refused weights are recorded and never appear as evidence records', async () => {
	const matrix = await readJson(matrixUrl);
	const refused = validateRefusedLocalModels(matrix.refusedLocalModels);
	const refusedIds = refused.map(({ id }) => id);

	for (const id of REFUSED_IDS) {
		assert.ok(refusedIds.includes(id), `${id} must stay recorded as refused`);
	}

	const recordIds = new Set(matrix.localModelEvidence.map(({ id }) => id));
	for (const id of refusedIds) {
		assert.ok(!recordIds.has(id), `${id} is refused and must not also be an evidence record`);
	}
});

test('distribution status and blocked requirements are derived, never authored', () => {
	const satisfied = validRecord();
	assert.deepEqual(deriveBlockedBy(satisfied), []);
	assert.equal(deriveDistributionStatus(satisfied), 'permitted');

	const waiting = validRecord({
		requirements: requirementEntries({
			'versioned-download-notices-and-hashes': { status: 'pending', summary: 'No artifact is mirrored yet.' },
			'weights-and-code-license-review': { status: 'unresolved', summary: 'Upstream has not answered.' },
		}),
	});
	assert.deepEqual(deriveBlockedBy(waiting), [
		'versioned-download-notices-and-hashes',
		'weights-and-code-license-review',
	]);
	assert.equal(deriveDistributionStatus(waiting), 'blocked');

	validateLocalModelEvidence([satisfied, { ...waiting, id: 'waiting-model' }], options());
});

test('an incomplete record cannot be authored into a distributable state', () => {
	const optimistic = validRecord({
		requirements: requirementEntries({
			'versioned-download-notices-and-hashes': { status: 'pending', summary: 'No artifact is mirrored yet.' },
		}),
		blockedBy: ['versioned-download-notices-and-hashes'],
		distributionStatus: 'permitted',
	});
	assertRefused([optimistic], /example-model: distributionStatus must be blocked/iu);

	const understated = validRecord({
		requirements: requirementEntries({
			'versioned-download-notices-and-hashes': { status: 'pending', summary: 'No artifact is mirrored yet.' },
		}),
		blockedBy: [],
		distributionStatus: 'blocked',
	});
	assertRefused([understated], /example-model: blockedBy must list/iu);
});

test('records must answer every gate requirement and invent none', () => {
	const requirements = requirementEntries();
	delete requirements['training-data-provenance-record'];
	assertRefused([validRecord({ requirements })], /example-model: requirements must answer/iu);

	assertRefused(
		[validRecord({ requirements: requirementEntries({ 'invented-requirement': { status: 'recorded', summary: 'No.' } }) })],
		/example-model: requirements must answer/iu,
	);

	assertRefused(
		[validRecord({ requirements: requirementEntries({ 'model-card-and-use-restrictions': { status: 'assumed', summary: 'No.' } }) })],
		/model-card-and-use-restrictions: status must be one of/iu,
	);

	assertRefused(
		[validRecord({ requirements: requirementEntries({ 'model-card-and-use-restrictions': { status: 'recorded', summary: '' } }) })],
		/model-card-and-use-restrictions: summary must be a non-empty string/iu,
	);
});

test('non-commercial and research-only weights are refused structurally', () => {
	assertRefused([validRecord({ weightsLicense: 'CC-BY-NC-4.0' })], /example-model: weightsLicense is not redistributable/iu);
	assertRefused([validRecord({ weightsLicense: 'Research use only' })], /example-model: weightsLicense is not redistributable/iu);
	assertRefused([validRecord({ codeLicense: 'CC-BY-NC-SA-4.0' })], /example-model: codeLicense is not redistributable/iu);
});

test('a refused model cannot be reintroduced as an evidence record', () => {
	assertRefused(
		[validRecord({ id: 'crisperwhisper' })],
		/crisperwhisper: model is recorded as refused/iu,
		options({ refusedIds: ['crisperwhisper'] }),
	);
});

test('duplicate records and misplaced upstream links are refused', () => {
	assertRefused([validRecord(), validRecord()], /example-model: duplicate record id/iu);

	assertRefused(
		[validRecord({ evidence: ['https://example.invalid/license'] })],
		/example-model: evidence must be repository paths/iu,
	);

	assertRefused(
		[validRecord({ provenanceSources: ['ftp://example.invalid/model'] })],
		/example-model: provenanceSources must be https URLs/iu,
	);

	assertRefused([validRecord({ purpose: '' })], /example-model: purpose must be a non-empty string/iu);
	assertRefused([validRecord({ unexpected: true })], /example-model: unexpected record keys/iu);
});

test('refused entries state a reason and stay unique', () => {
	const entry = { id: 'crisperwhisper', license: 'CC-BY-NC-4.0', reason: 'Non-commercial weights.' };
	validateRefusedLocalModels([entry]);

	assert.throws(
		() => validateRefusedLocalModels([entry, entry]),
		/crisperwhisper: duplicate refused id/iu,
	);
	assert.throws(
		() => validateRefusedLocalModels([{ ...entry, reason: '' }]),
		/crisperwhisper: reason must be a non-empty string/iu,
	);
	assert.throws(
		() => validateRefusedLocalModels([{ ...entry, extra: 1 }]),
		/crisperwhisper: unexpected refusal keys/iu,
	);
});

async function readJson(url) {
	return JSON.parse(await readFile(url, 'utf8'));
}

async function assertEvidence(references) {
	for (const reference of references) {
		const [path] = reference.split('#');
		await assert.doesNotReject(access(new URL(path, repositoryUrl)), `Missing evidence: ${reference}`);
	}
}

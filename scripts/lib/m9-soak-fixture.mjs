/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';

import {
	boundedString,
	deepFreeze,
	exactRecord,
	positiveInteger,
} from './measurement-admission.mjs';
import { snapshotStrictJsonData } from './strict-json-snapshot.mjs';
import { validateSoundscaperStable1SoakEvidenceAuthority } from
	'./soundscaper-stable-1-soak-attestation.mjs';

const SPEC_FIELDS = Object.freeze([
	'schemaVersion', 'fixtureId', 'workloadId', 'environmentId', 'productIds', 'generator',
	'qualification', 'contract',
	'operations', 'schedule', 'repeatabilityBands', 'generatedArtifacts',
]);
const GENERATOR_FIELDS = Object.freeze(['id', 'revision', 'seed', 'sourcePath', 'sourceSha256']);
const RUN_FIELDS = Object.freeze([
	'durationSeconds', 'warmupSeconds', 'sampleIntervalSeconds', 'qualificationEligible',
]);
const OPERATION_FIELDS = Object.freeze(['id', 'productId', 'kind']);
const SCHEDULE_FIELDS = Object.freeze(['operationId', 'cadenceSeconds', 'offsetSeconds']);
const BAND_FIELDS = Object.freeze(['metricId', 'maximumAbsoluteDifference']);
const ARTIFACT_FIELDS = Object.freeze(['byteLength', 'sha256', 'scheduleSha256', 'eventCount']);
const SHA256 = /^[a-f0-9]{64}$/u;
const MODES = Object.freeze(['qualification', 'contract']);
const PRODUCTS = Object.freeze(['soundscaper', 'framescaper']);

export function validateM9SoakSpec(value) {
	const spec = validateSpecShape(value);
	for (const mode of MODES) {
		const fixture = generateValidatedFixture(spec, mode);
		const actual = artifactPin(fixture);
		const expected = spec.generatedArtifacts[mode];
		if (JSON.stringify(actual) !== JSON.stringify(expected)) {
			throw new Error(`M9 ${mode} generated artifact does not match its specification pin.`);
		}
	}
	return spec;
}

export function deriveM9SoakArtifactPins(value) {
	const spec = validateSpecShape(value);
	return deepFreeze(Object.fromEntries(MODES.map((mode) => [
		mode, artifactPin(generateValidatedFixture(spec, mode)),
	])));
}

export function generateM9SoakFixture(specValue, modeValue = 'qualification') {
	const spec = validateM9SoakSpec(specValue);
	const mode = boundedString(modeValue, 1, 32, 'M9 soak mode');
	if (!MODES.includes(mode)) throw new Error(`Unsupported M9 soak mode ${mode}.`);
	return generateValidatedFixture(spec, mode);
}

export function canonicalM9SoakFixtureBytes(fixtureValue) {
	const fixture = snapshotStrictJsonData(fixtureValue, 'M9 soak fixture');
	return Buffer.from(`${JSON.stringify(fixture, null, '\t')}\n`, 'utf8');
}

export function m9SoakScheduleSha256(fixtureValue) {
	const fixture = exactRecord(
		snapshotStrictJsonData(fixtureValue, 'M9 soak fixture'),
		[
			'schemaVersion', 'fixtureId', 'workloadId', 'mode', 'qualificationEligible',
			'durationSeconds', 'warmupSeconds', 'sampleIntervalSeconds', 'generator',
			'projects', 'schedule',
		],
		'M9 soak fixture',
	);
	return sha256(Buffer.from(`${JSON.stringify(fixture.schedule, null, '\t')}\n`, 'utf8'));
}

function validateSpecShape(value) {
	const snapshot = snapshotStrictJsonData(value, 'M9 soak specification');
	const fields = snapshot.schemaVersion === 2
		? [...SPEC_FIELDS, 'evidenceAuthority']
		: SPEC_FIELDS;
	const spec = exactRecord(
		snapshot, fields, 'M9 soak specification',
	);
	if (![1, 2].includes(spec.schemaVersion)) throw new Error('M9 soak specification schemaVersion is invalid.');
	boundedString(spec.fixtureId, 1, 128, 'M9 fixtureId');
	boundedString(spec.workloadId, 1, 128, 'M9 workloadId');
	boundedString(spec.environmentId, 1, 128, 'M9 environmentId');
	const productIds = denseArray(spec.productIds, 'M9 product IDs').map((productId, index) => {
		if (!PRODUCTS.includes(productId)) throw new Error(`M9 productIds[${index}] is invalid.`);
		return productId;
	});
	assertUnique(productIds, 'M9 product IDs');
	const generator = exactRecord(spec.generator, GENERATOR_FIELDS, 'M9 generator');
	boundedString(generator.id, 1, 128, 'M9 generator.id');
	positiveInteger(generator.revision, 'M9 generator.revision');
	boundedString(generator.seed, 16, 256, 'M9 generator.seed');
	if (generator.sourcePath !== 'scripts/lib/m9-soak-fixture.mjs'
		|| !SHA256.test(generator.sourceSha256)) {
		throw new Error('M9 generator source pin is invalid.');
	}
	const qualification = validateRun(spec.qualification, 'qualification', true);
	const contract = validateRun(spec.contract, 'contract', false);
	if (qualification.durationSeconds !== 28_800) {
		throw new Error('M9 qualification duration must be exactly eight hours.');
	}
	if (contract.durationSeconds >= qualification.durationSeconds) {
		throw new Error('M9 contract mode must be shorter than qualification.');
	}
	const operations = denseArray(spec.operations, 'M9 operations').map((operation, index) => {
		const row = exactRecord(operation, OPERATION_FIELDS, `M9 operations[${index}]`);
		boundedString(row.id, 1, 128, `M9 operations[${index}].id`);
		if (!PRODUCTS.includes(row.productId)) throw new Error('M9 operation productId is invalid.');
		boundedString(row.kind, 1, 128, `M9 operations[${index}].kind`);
		return row;
	});
	assertUnique(operations.map(({ id }) => id), 'M9 operation IDs');
	if (!productIds.every((productId) => operations.some((operation) => operation.productId === productId))
		|| operations.some((operation) => !productIds.includes(operation.productId))) {
		throw new Error('M9 operations must cover exactly the selected products.');
	}
	const evidenceAuthority = spec.schemaVersion === 2
		? validateSoundscaperStable1SoakEvidenceAuthority(spec.evidenceAuthority)
		: undefined;
	if (spec.schemaVersion === 2 && (spec.workloadId !== 'soundscaper-stable-1-complete-system-soak'
		|| JSON.stringify(productIds) !== JSON.stringify(['soundscaper']))) {
		throw new Error('M9 signed-attestation schema is reserved for the Soundscaper Stable 1 workload.');
	}
	const operationIds = new Set(operations.map(({ id }) => id));
	const schedule = denseArray(spec.schedule, 'M9 schedule').map((entry, index) => {
		const row = exactRecord(entry, SCHEDULE_FIELDS, `M9 schedule[${index}]`);
		if (!operationIds.has(row.operationId)) throw new Error('M9 schedule names an unknown operation.');
		positiveInteger(row.cadenceSeconds, `M9 schedule[${index}].cadenceSeconds`);
		if (!Number.isSafeInteger(row.offsetSeconds) || row.offsetSeconds < 0
			|| row.offsetSeconds >= row.cadenceSeconds) {
			throw new Error('M9 schedule offset must be a non-negative integer below its cadence.');
		}
		return row;
	});
	assertUnique(schedule.map(({ operationId }) => operationId), 'M9 schedule operation IDs');
	if (schedule.length !== operations.length) throw new Error('M9 schedule must cover every operation exactly once.');
	const repeatabilityBands = denseArray(spec.repeatabilityBands, 'M9 repeatability bands')
		.map((band, index) => {
			const row = exactRecord(band, BAND_FIELDS, `M9 repeatabilityBands[${index}]`);
			boundedString(row.metricId, 1, 128, `M9 repeatabilityBands[${index}].metricId`);
			if (!Number.isFinite(row.maximumAbsoluteDifference)
				|| row.maximumAbsoluteDifference < 0) {
				throw new Error('M9 repeatability band must be finite and non-negative.');
			}
			return row;
		});
	assertUnique(repeatabilityBands.map(({ metricId }) => metricId), 'M9 repeatability metric IDs');
	const generatedArtifacts = exactRecord(
		spec.generatedArtifacts, MODES, 'M9 generated artifacts',
	);
	for (const mode of MODES) validateArtifactPin(generatedArtifacts[mode], mode);
	return deepFreeze({
		...spec,
		productIds: [...productIds],
		generator: { ...generator },
		qualification,
		contract,
		operations: operations.map((row) => ({ ...row })),
		schedule: schedule.map((row) => ({ ...row })),
		repeatabilityBands: repeatabilityBands.map((row) => ({ ...row })),
		generatedArtifacts: Object.fromEntries(MODES.map((mode) => [
			mode, { ...generatedArtifacts[mode] },
		])),
		...(evidenceAuthority === undefined ? {} : { evidenceAuthority }),
	});
}

function validateRun(value, mode, qualificationEligible) {
	const run = exactRecord(value, RUN_FIELDS, `M9 ${mode} run specification`);
	positiveInteger(run.durationSeconds, `M9 ${mode}.durationSeconds`);
	if (!Number.isSafeInteger(run.warmupSeconds) || run.warmupSeconds < 0
		|| run.warmupSeconds >= run.durationSeconds) {
		throw new Error(`M9 ${mode} warmup must be shorter than its duration.`);
	}
	positiveInteger(run.sampleIntervalSeconds, `M9 ${mode}.sampleIntervalSeconds`);
	if (run.durationSeconds % run.sampleIntervalSeconds !== 0
		|| run.warmupSeconds % run.sampleIntervalSeconds !== 0) {
		throw new Error(`M9 ${mode} duration and warmup must align to its sample interval.`);
	}
	if (run.qualificationEligible !== qualificationEligible) {
		throw new Error(`M9 ${mode} qualification eligibility is invalid.`);
	}
	return run;
}

function validateArtifactPin(value, mode) {
	const pin = exactRecord(value, ARTIFACT_FIELDS, `M9 ${mode} generated artifact`);
	positiveInteger(pin.byteLength, `M9 ${mode} artifact byteLength`);
	positiveInteger(pin.eventCount, `M9 ${mode} artifact eventCount`);
	if (!SHA256.test(pin.sha256) || !SHA256.test(pin.scheduleSha256)) {
		throw new Error(`M9 ${mode} generated artifact pin is invalid.`);
	}
}

function generateValidatedFixture(spec, mode) {
	const run = spec[mode];
	const random = seededRandom(`${spec.generator.seed}:${mode}`);
	const projects = spec.productIds.map((productId, productIndex) => deepFreeze({
		productId,
		projectId: `${productId}-m9-${randomHex(random)}`,
		tracks: Array.from({ length: 4 }, (_, trackIndex) => deepFreeze({
			id: `${productId}-track-${String(trackIndex + 1)}`,
			kind: trackIndex === 3 ? 'video' : 'audio',
			clipSeed: randomHex(random),
			startFrame: productIndex + (trackIndex * 900),
			durationFrames: 5_400 + Math.floor(random() * 5_400),
		})),
	}));
	const schedule = mode === 'contract'
		? contractSchedule(spec, run, random)
		: qualificationSchedule(spec, run, random);
	return deepFreeze({
		schemaVersion: 1,
		fixtureId: spec.fixtureId,
		workloadId: spec.workloadId,
		mode,
		qualificationEligible: run.qualificationEligible,
		durationSeconds: run.durationSeconds,
		warmupSeconds: run.warmupSeconds,
		sampleIntervalSeconds: run.sampleIntervalSeconds,
		generator: {
			id: spec.generator.id,
			revision: spec.generator.revision,
			seed: spec.generator.seed,
		},
		projects,
		schedule,
	});
}

function qualificationSchedule(spec, run, random) {
	const operations = new Map(spec.operations.map((operation) => [operation.id, operation]));
	const pending = [];
	for (const rule of spec.schedule) {
		for (let elapsedSeconds = rule.offsetSeconds;
			elapsedSeconds < run.durationSeconds;
			elapsedSeconds += rule.cadenceSeconds) {
			pending.push({ elapsedSeconds, operation: operations.get(rule.operationId) });
		}
	}
	return scheduleRows(pending, random);
}

function contractSchedule(spec, run, random) {
	const spacing = Math.floor(run.durationSeconds / (spec.operations.length + 1));
	return scheduleRows(spec.operations.map((operation, index) => ({
		elapsedSeconds: spacing * (index + 1), operation,
	})), random);
}

function scheduleRows(pending, random) {
	return pending
		.sort((left, right) => left.elapsedSeconds - right.elapsedSeconds
			|| left.operation.id.localeCompare(right.operation.id))
		.map(({ elapsedSeconds, operation }, index) => deepFreeze({
			eventId: `m9-${String(index + 1).padStart(5, '0')}-${randomHex(random)}`,
			elapsedSeconds,
			productId: operation.productId,
			operationId: operation.id,
			kind: operation.kind,
			variant: Math.floor(random() * 16),
		}));
}

function seededRandom(seed) {
	let state = createHash('sha256').update(seed).digest().readUInt32LE(0) || 1;
	return () => {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		return (state >>> 0) / 0x1_0000_0000;
	};
}

function randomHex(random) {
	return Math.floor(random() * 0x1_0000_0000).toString(16).padStart(8, '0');
}

function artifactPin(fixture) {
	const bytes = canonicalM9SoakFixtureBytes(fixture);
	return {
		byteLength: bytes.byteLength,
		sha256: sha256(bytes),
		scheduleSha256: m9SoakScheduleSha256(fixture),
		eventCount: fixture.schedule.length,
	};
}

function denseArray(value, path) {
	if (!Array.isArray(value) || value.length === 0
		|| Reflect.ownKeys(value).length !== value.length + 1) {
		throw new Error(`${path} must be a non-empty dense array.`);
	}
	return value;
}

function assertUnique(values, path) {
	if (new Set(values).size !== values.length) throw new Error(`${path} must be unique.`);
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

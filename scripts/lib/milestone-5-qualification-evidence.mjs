/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual, promisify } from 'node:util';

import { createM5NativeHelperCohort } from './m5-native-helper-cohort.mjs';
import { createM5bQualityCohortV2 } from './m5b-quality-cohort-v2.mjs';
import {
	NATIVE_OS_LAB_ENVIRONMENT_ID,
	NATIVE_OS_LAB_PROFILES_V2,
	validateNativeOsLabEnvironmentV2,
	validateNativeOsLabMeasurementBindingV2,
} from './native-os-lab-schema.mjs';
import {
	boundedString,
	deepFreeze,
	exactRecord,
	positiveInteger,
	requireRecord,
} from './measurement-admission.mjs';
import { snapshotStrictJsonData } from './strict-json-snapshot.mjs';
import { milestone5EngineeringScope } from './milestone-5-product-scope.mjs';

export const MILESTONE_5_QUALIFICATION_EVIDENCE_PATH =
	'config/milestone-5-qualification-evidence.json';
export const MILESTONE_5_QUALIFICATION_EVIDENCE_ROOT = 'qualification/milestone-5';

const QUALITY_BUDGET_PATH = 'config/quality-budgets.json';
const REGISTER_FIELDS = Object.freeze(['schemaVersion', 'environmentId', 'evidenceRoot', 'rows']);
const ROW_FIELDS = Object.freeze([
	'workloadId', 'productId', 'pipelineId', 'requiredLabProfileIds', 'status',
	'blockedBy', 'sourceRevision', 'budgetSha256', 'cohort', 'measurements',
]);
const PIN_FIELDS = Object.freeze(['path', 'byteLength', 'sha256']);
const MEASUREMENT_FIELDS = Object.freeze(['labProfileId', ...PIN_FIELDS]);
const SHA256 = /^[a-f0-9]{64}$/u;
const SOURCE_REVISION = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const MAXIMUM_EVIDENCE_BYTES = 256 * 1024 * 1024;
const AUDITED_QUALIFICATION = new WeakSet();
const PAYLOAD_DIGEST_FIELDS = Object.freeze([
	'packageSha256', 'helperBinarySha256', 'nativeAddonSha256', 'mediaHostSha256',
	'ofxScannerSha256', 'ofxRuntimeHostSha256',
]);
const execFileAsync = promisify(execFile);

const soundscaperProfiles = NATIVE_OS_LAB_PROFILES_V2
	.filter(({ productId }) => productId === 'soundscaper');
const framescaperProfiles = NATIVE_OS_LAB_PROFILES_V2
	.filter(({ productId }) => productId === 'framescaper');

function qualificationRow(workloadId, fixtureId, productId, pipelineId, profiles) {
	return deepFreeze({
		workloadId,
		fixtureId,
		productId,
		pipelineId,
		profiles: [...profiles],
		requiredLabProfileIds: profiles.map(({ id }) => id),
	});
}

export const MILESTONE_5_QUALIFICATION_ROWS = deepFreeze([
	qualificationRow(
		'm5-native-helper-and-audio',
		'm5-helper-fault-and-loopback-v1',
		'soundscaper',
		null,
		soundscaperProfiles,
	),
	qualificationRow(
		'm5b-native-media-plan-parity-and-decode',
		'm5b-native-media-parity-and-longform-v1',
		'framescaper',
		'native-media',
		framescaperProfiles,
	),
	qualificationRow(
		'm5b-professional-media-tier',
		'm5b-professional-format-row-suite-v1',
		'framescaper',
		'professional-media',
		framescaperProfiles,
	),
	qualificationRow(
		'm5b-persistent-services-recovery',
		'm5b-persistent-services-fault-v1',
		'framescaper',
		'persistent-services',
		framescaperProfiles,
	),
	qualificationRow(
		'm5b-clean-external-display',
		'm5b-clean-display-30m-v1',
		'framescaper',
		'clean-display',
		framescaperProfiles,
	),
	qualificationRow(
		'm5b-openfx-isolation-and-packaging',
		'm5b-openfx-conformance-and-hostile-v1',
		'framescaper',
		'openfx',
		framescaperProfiles,
	),
]);

export async function readMilestone5QualificationEvidenceRegister(
	repositoryRoot,
	registerPath = MILESTONE_5_QUALIFICATION_EVIDENCE_PATH,
) {
	const root = boundedString(repositoryRoot, 1, 4_096, 'repository root');
	const path = boundedString(registerPath, 1, 4_096, 'qualification register path');
	const bytes = await readFile(resolve(root, path));
	return validateMilestone5QualificationEvidenceRegister(parseJson(bytes, path));
}

export function validateMilestone5QualificationEvidenceRegister(value) {
	const register = exactRecord(
		snapshotStrictJsonData(value, 'Milestone 5 qualification evidence register'),
		REGISTER_FIELDS,
		'Milestone 5 qualification evidence register',
	);
	if (register.schemaVersion !== 1
		|| register.environmentId !== NATIVE_OS_LAB_ENVIRONMENT_ID
		|| register.evidenceRoot !== MILESTONE_5_QUALIFICATION_EVIDENCE_ROOT) {
		throw new Error('Milestone 5 qualification register identity is invalid.');
	}
	if (!Array.isArray(register.rows)
		|| register.rows.length !== MILESTONE_5_QUALIFICATION_ROWS.length) {
		throw new Error('Milestone 5 qualification register must contain the exact six rows.');
	}
	const rows = register.rows.map((row, index) => validateRegisterRow(
		row,
		MILESTONE_5_QUALIFICATION_ROWS[index],
		index,
	));
	return deepFreeze({ ...register, rows });
}

export async function auditMilestone5QualificationEvidence(optionsValue, dependencies = {}) {
	const options = requireRecord(optionsValue, 'Milestone 5 qualification audit options');
	const scope = milestone5EngineeringScope(options.productIds);
	const repositoryRoot = boundedString(
		options.repositoryRoot,
		1,
		4_096,
		'Milestone 5 qualification repositoryRoot',
	);
	let register;
	let registerEvidence = null;
	if (options.register === undefined) {
		const registerPath = options.registerPath ?? MILESTONE_5_QUALIFICATION_EVIDENCE_PATH;
		const bytes = await readFile(resolve(repositoryRoot, registerPath));
		register = validateMilestone5QualificationEvidenceRegister(parseJson(bytes, registerPath));
		registerEvidence = descriptor(registerPath, bytes);
	} else register = validateMilestone5QualificationEvidenceRegister(options.register);
	const loadHistoricalQualityBudget = dependencies.loadHistoricalQualityBudget
		?? ((revision) => loadHistoricalQualityBudgetFromGit(repositoryRoot, revision));
	const nativeConstructor = dependencies.createM5NativeHelperCohort
		?? createM5NativeHelperCohort;
	const framescaperConstructor = dependencies.createM5bQualityCohortV2
		?? createM5bQualityCohortV2;
	const selectedRows = register.rows.filter(({ workloadId }) => scope.workloadIds.includes(workloadId));
	const acceptedRows = selectedRows.filter(({ status }) => status === 'accepted');
	const historicalConfigs = new Map();
	const observations = [];
	const auditedRows = [];
	const cohorts = [];
	const usedPaths = new Set();
	validateOneHistoricalSourceAndBudget(acceptedRows);

	for (const row of selectedRows) {
		const definition = MILESTONE_5_QUALIFICATION_ROWS.find(({ workloadId }) => (
			workloadId === row.workloadId
		));
		if (row.status === 'pending-external') {
			auditedRows.push(rowAuditSummary(row, 0));
			continue;
		}
		const config = await historicalConfig(
			row,
			historicalConfigs,
			loadHistoricalQualityBudget,
		);
		const environment = historicalEnvironment(config, definition);
		const measurements = [];
		for (const descriptor of row.measurements) {
			assertUnusedPath(descriptor.path, usedPaths);
			const file = await readPinnedEvidence(repositoryRoot, descriptor, 'raw measurement');
			const measurement = parseJson(file.bytes, descriptor.path);
			const binding = validateMeasurementIdentity(measurement, row, definition, descriptor, environment);
			measurements.push(measurement);
			observations.push({ productId: row.productId, binding });
		}
		const recomputed = snapshotStrictJsonData(
			row.pipelineId === null
				? nativeConstructor(measurements, config, row.budgetSha256)
				: framescaperConstructor(row.pipelineId, measurements, config, row.budgetSha256),
			`${row.workloadId} recomputed cohort`,
		);
		validateAcceptedCohort(recomputed, row);
		assertUnusedPath(row.cohort.path, usedPaths);
		const cohortFile = await readPinnedEvidence(repositoryRoot, row.cohort, 'cohort');
		const canonicalBytes = Buffer.from(`${JSON.stringify(recomputed, null, '\t')}\n`, 'utf8');
		if (!cohortFile.bytes.equals(canonicalBytes)) {
			throw new Error(`${row.workloadId} cohort bytes do not match the recomputed canonical cohort.`);
		}
		cohorts.push(deepFreeze(recomputed));
		auditedRows.push(rowAuditSummary(row, measurements.length));
	}

	validateCrossRowObservations(observations);
	const pendingBlockers = selectedRows
		.filter(({ status }) => status === 'pending-external')
		.map(({ workloadId, blockedBy }) => `${workloadId}: ${blockedBy}`);
	const qualificationReady = acceptedRows.length === selectedRows.length;
	const historicalBudget = historicalConfigs.values().next().value;
	const audit = deepFreeze({
		passed: true,
		qualificationReady,
		status: qualificationReady ? 'accepted' : 'pending-external',
		registerEvidence,
		environmentId: register.environmentId,
		sourceRevision: acceptedRows[0]?.sourceRevision ?? null,
		budgetSha256: acceptedRows[0]?.budgetSha256 ?? null,
		historicalBudgetByteLength: historicalBudget?.bytes.byteLength ?? null,
		rowCount: selectedRows.length,
		measurementDescriptorCount: selectedRows.reduce(
			(count, row) => count + row.measurements.length,
			0,
		),
		acceptedCohortCount: acceptedRows.length,
		auditedMeasurementCount: observations.length,
		blockers: pendingBlockers,
		rows: auditedRows,
		cohorts,
	});
	AUDITED_QUALIFICATION.add(audit);
	return audit;
}

function descriptor(path, bytes) {
	return {
		path,
		byteLength: bytes.byteLength,
		sha256: sha256(bytes),
	};
}

export function isAuditedMilestone5QualificationEvidence(value) {
	return value !== null && typeof value === 'object' && AUDITED_QUALIFICATION.has(value);
}

async function historicalConfig(row, cache, loadHistoricalQualityBudget) {
	let entry = cache.get(row.sourceRevision);
	if (entry === undefined) {
		const loaded = await loadHistoricalQualityBudget(row.sourceRevision);
		const bytes = evidenceBuffer(loaded, 'historical quality budget');
		entry = { bytes, digest: sha256(bytes), config: parseJson(bytes, QUALITY_BUDGET_PATH) };
		cache.set(row.sourceRevision, entry);
	}
	if (entry.digest !== row.budgetSha256) {
		throw new Error(`${row.workloadId} historical budget digest does not match its register pin.`);
	}
	return entry.config;
}

async function loadHistoricalQualityBudgetFromGit(repositoryRoot, sourceRevision) {
	if (!SOURCE_REVISION.test(sourceRevision)) throw new Error('Historical source revision is invalid.');
	const { stdout } = await execFileAsync(
		'git',
		['show', `${sourceRevision}:${QUALITY_BUDGET_PATH}`],
		{ cwd: repositoryRoot, encoding: null, maxBuffer: 16 * 1024 * 1024 },
	);
	return stdout;
}

function historicalEnvironment(configValue, definition) {
	const config = requireRecord(configValue, 'historical quality config');
	const environment = exactDescriptor(
		config.environments,
		NATIVE_OS_LAB_ENVIRONMENT_ID,
		'historical environment',
	);
	const workload = exactDescriptor(config.workloads, definition.workloadId, 'historical workload');
	exactDescriptor(config.fixtures, definition.fixtureId, 'historical fixture');
	if (!isDeepStrictEqual(workload.fixtureIds, [definition.fixtureId])
		|| !isDeepStrictEqual(workload.environmentIds, [NATIVE_OS_LAB_ENVIRONMENT_ID])) {
		throw new Error(`${definition.workloadId} historical workload registration is not exact.`);
	}
	return validateNativeOsLabEnvironmentV2(environment);
}

function validateMeasurementIdentity(measurementValue, row, definition, descriptor, environment) {
	const measurement = requireRecord(measurementValue, `${descriptor.path} measurement`);
	if (measurement.schemaVersion !== 2
		|| measurement.workloadId !== row.workloadId
		|| measurement.fixtureId !== definition.fixtureId
		|| measurement.environmentId !== NATIVE_OS_LAB_ENVIRONMENT_ID
		|| measurement.budgetSha256 !== row.budgetSha256
		|| measurement.sourceRevision !== row.sourceRevision) {
		throw new Error(`${descriptor.path} measurement identity or historical budget binding does not match.`);
	}
	if (row.pipelineId === null) {
		if (Object.hasOwn(measurement, 'profileId') && measurement.profileId !== undefined) {
			throw new Error(`${descriptor.path} native-helper measurement must not claim a 5B pipeline.`);
		}
	} else if (measurement.profileId !== row.pipelineId) {
		throw new Error(`${descriptor.path} measurement pipeline profile does not match.`);
	}
	const binding = validateNativeOsLabMeasurementBindingV2(measurement.labBinding, environment);
	if (binding.profileId !== descriptor.labProfileId
		|| binding.profile.productId !== row.productId
		|| measurement.platformId !== binding.platformId
		|| binding.artifacts.sourceRevision !== row.sourceRevision) {
		throw new Error(`${descriptor.path} observed profile identity does not match its register descriptor.`);
	}
	return binding;
}

function validateAcceptedCohort(cohort, row) {
	if (cohort.schemaVersion !== 2
		|| cohort.status !== 'accepted'
		|| cohort.workloadId !== row.workloadId
		|| cohort.environmentId !== NATIVE_OS_LAB_ENVIRONMENT_ID
		|| cohort.sourceRevision !== row.sourceRevision
		|| cohort.budgetSha256 !== row.budgetSha256
		|| !isDeepStrictEqual(cohort.labProfileIds, row.requiredLabProfileIds)
		|| cohort.qualificationEvidencePublished !== true
		|| cohort.evaluation?.passed !== true) {
		throw new Error(`${row.workloadId} recomputed cohort is not exact accepted qualification evidence.`);
	}
	if (row.pipelineId !== null && cohort.profileId !== row.pipelineId) {
		throw new Error(`${row.workloadId} recomputed cohort pipeline does not match.`);
	}
}

function validateOneHistoricalSourceAndBudget(rows) {
	if (new Set(rows.map(({ sourceRevision }) => sourceRevision)).size > 1
		|| new Set(rows.map(({ budgetSha256 }) => budgetSha256)).size > 1) {
		throw new Error('Accepted Milestone 5 evidence must bind one source revision and budget.');
	}
}

function validateCrossRowObservations(observations) {
	const hosts = new Map();
	const payloads = new Map();
	for (const { productId, binding } of observations) {
		const priorHost = hosts.get(binding.platformId);
		if (priorHost !== undefined && !isDeepStrictEqual(priorHost, binding.physicalHost)) {
			throw new Error(`Milestone 5 ${binding.platformId} observations do not bind one physical host.`);
		}
		hosts.set(binding.platformId, binding.physicalHost);
		for (const field of PAYLOAD_DIGEST_FIELDS) {
			const digest = binding.artifacts[field];
			if (digest === null) continue;
			const key = `${productId}:${binding.platformId}:${field}`;
			const priorDigest = payloads.get(key);
			if (priorDigest !== undefined && priorDigest !== digest) {
				throw new Error(`Milestone 5 ${productId} ${binding.platformId} ${field} payload digest is inconsistent.`);
			}
			payloads.set(key, digest);
		}
	}
}

async function readPinnedEvidence(repositoryRoot, descriptor, label) {
	validateCanonicalEvidencePath(descriptor.path, label);
	const root = resolve(repositoryRoot);
	const absolutePath = resolve(root, descriptor.path);
	if (!isContainedPath(root, absolutePath)) throw new Error(`${label} path escapes the repository.`);
	const fileStats = await assertRegularNonSymbolicPath(root, absolutePath, label);
	if (fileStats.size !== descriptor.byteLength) {
		throw new Error(`${label} byte length does not match its register pin.`);
	}
	const resolvedRoot = await realpath(root);
	const resolvedEvidenceRoot = await realpath(resolve(root, MILESTONE_5_QUALIFICATION_EVIDENCE_ROOT));
	const resolvedFile = await realpath(absolutePath);
	if (!isContainedPath(resolvedRoot, resolvedFile)
		|| !isContainedPath(resolvedEvidenceRoot, resolvedFile)) {
		throw new Error(`${label} path escapes the qualification evidence root.`);
	}
	const bytes = await readFile(absolutePath);
	if (bytes.byteLength !== descriptor.byteLength || sha256(bytes) !== descriptor.sha256) {
		throw new Error(`${label} byte length or digest does not match its register pin.`);
	}
	return { bytes, path: absolutePath };
}

async function assertRegularNonSymbolicPath(repositoryRoot, absolutePath, label) {
	const pathFromRoot = relative(repositoryRoot, absolutePath);
	let cursor = repositoryRoot;
	let fileStats;
	for (const segment of pathFromRoot.split(sep)) {
		cursor = resolve(cursor, segment);
		const stats = await lstat(cursor);
		if (stats.isSymbolicLink()) throw new Error(`${label} must be a regular non-symbolic file path.`);
		if (cursor === absolutePath ? !stats.isFile() : !stats.isDirectory()) {
			throw new Error(`${label} must be a regular non-symbolic file path.`);
		}
		if (cursor === absolutePath) fileStats = stats;
	}
	return fileStats;
}

function validateRegisterRow(value, definition, index) {
	const row = exactRecord(value, ROW_FIELDS, `qualification rows[${index}]`);
	if (row.workloadId !== definition.workloadId
		|| row.productId !== definition.productId
		|| row.pipelineId !== definition.pipelineId
		|| !isDeepStrictEqual(row.requiredLabProfileIds, definition.requiredLabProfileIds)) {
		throw new Error(`Qualification row ${index} identity or exact profile order does not match.`);
	}
	if (!Array.isArray(row.measurements)
		|| row.measurements.length !== definition.requiredLabProfileIds.length) {
		throw new Error(`Qualification row ${row.workloadId} must enumerate its exact measurements.`);
	}
	const cohort = exactRecord(row.cohort, PIN_FIELDS, `${row.workloadId} cohort pin`);
	const measurements = row.measurements.map((measurement, measurementIndex) => {
		const descriptor = exactRecord(
			measurement,
			MEASUREMENT_FIELDS,
			`${row.workloadId} measurements[${measurementIndex}]`,
		);
		if (descriptor.labProfileId !== definition.requiredLabProfileIds[measurementIndex]) {
			throw new Error(`${row.workloadId} measurement profile order is not exact.`);
		}
		return descriptor;
	});
	if (row.status === 'pending-external') validatePendingRow(row, cohort, measurements);
	else if (row.status === 'accepted') validateAcceptedRow(row, cohort, measurements);
	else throw new Error(`${row.workloadId} row status is unsupported.`);
	return deepFreeze({ ...row, cohort: { ...cohort }, measurements: measurements.map((item) => ({ ...item })) });
}

function validatePendingRow(row, cohort, measurements) {
	boundedString(row.blockedBy, 1, 2_048, `${row.workloadId} pending blocker`);
	if (row.sourceRevision !== null || row.budgetSha256 !== null
		|| Object.values(cohort).some((value) => value !== null)
		|| measurements.some(({ path, byteLength, sha256: digest }) => (
			path !== null || byteLength !== null || digest !== null
		))) throw new Error(`${row.workloadId} pending row must not claim accepted evidence pins.`);
}

function validateAcceptedRow(row, cohort, measurements) {
	if (row.blockedBy !== null || !SOURCE_REVISION.test(String(row.sourceRevision))
		|| !SHA256.test(String(row.budgetSha256))) {
		throw new Error(`${row.workloadId} accepted row source, budget, or blocker is invalid.`);
	}
	validateAcceptedPin(cohort, `${row.workloadId} cohort`);
	for (const descriptor of measurements) validateAcceptedPin(descriptor, `${row.workloadId} measurement`);
}

function validateAcceptedPin(pin, label) {
	validateCanonicalEvidencePath(pin.path, label);
	positiveInteger(pin.byteLength, `${label} byteLength`);
	if (pin.byteLength > MAXIMUM_EVIDENCE_BYTES) {
		throw new Error(`${label} exceeds the qualification evidence byte limit.`);
	}
	if (!SHA256.test(String(pin.sha256))) throw new Error(`${label} SHA-256 is invalid.`);
}

function validateCanonicalEvidencePath(value, label) {
	const path = boundedString(value, 1, 4_096, `${label} path`);
	const prefix = `${MILESTONE_5_QUALIFICATION_EVIDENCE_ROOT}/`;
	if (isAbsolute(path) || path.includes('\\') || !path.startsWith(prefix)
		|| path.endsWith('/') || path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
		throw new Error(`${label} path must be canonical and repo-relative under ${MILESTONE_5_QUALIFICATION_EVIDENCE_ROOT}.`);
	}
	return path;
}

function exactDescriptor(values, id, label) {
	if (!Array.isArray(values)) throw new Error(`${label} registry must be an array.`);
	const matches = values.filter((candidate) => candidate?.id === id);
	if (matches.length !== 1) throw new Error(`${label} ${id} must occur exactly once.`);
	return requireRecord(matches[0], `${label} ${id}`);
}

function parseJson(bytes, label) {
	try {
		return JSON.parse(evidenceBuffer(bytes, label).toString('utf8'));
	} catch (error) {
		throw new Error(`${label} must contain valid JSON.`, { cause: error });
	}
}

function evidenceBuffer(value, label) {
	if (Buffer.isBuffer(value)) return value;
	if (value instanceof Uint8Array) return Buffer.from(value);
	if (typeof value === 'string') return Buffer.from(value, 'utf8');
	throw new TypeError(`${label} loader must return exact bytes.`);
}

function assertUnusedPath(path, paths) {
	if (paths.has(path)) throw new Error(`Qualification evidence path ${path} is registered more than once.`);
	paths.add(path);
}

function isContainedPath(root, candidate) {
	const fromRoot = relative(root, candidate);
	return fromRoot !== '' && !fromRoot.startsWith(`..${sep}`) && fromRoot !== '..' && !isAbsolute(fromRoot);
}

function rowAuditSummary(row, auditedMeasurementCount) {
	return deepFreeze({
		workloadId: row.workloadId,
		productId: row.productId,
		pipelineId: row.pipelineId,
		status: row.status,
		blockedBy: row.blockedBy,
		sourceRevision: row.sourceRevision,
		budgetSha256: row.budgetSha256,
		requiredLabProfileIds: [...row.requiredLabProfileIds],
		auditedMeasurementCount,
		cohort: { ...row.cohort },
	});
}

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}

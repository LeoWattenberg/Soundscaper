/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual, promisify } from 'node:util';

import {
	M6_REFERENCE_MASTER_ENVIRONMENT_IDS,
	M6_REFERENCE_MASTER_FIXTURE_IDS,
	M6_REFERENCE_MASTER_METRIC_IDS,
	M6_REFERENCE_MASTER_WORKLOAD_ID,
	computeM6ReferenceMasterMetrics,
} from './m6-reference-master-metrics.mjs';
import {
	NATIVE_OS_LAB_ENVIRONMENT_ID,
	NATIVE_OS_LAB_PROFILES_V2,
	assessNativeOsLabBindingQualificationV2,
	validateNativeOsLabEnvironmentV2,
} from './native-os-lab-schema.mjs';
import {
	boundedString,
	deepFreeze,
	exactRecord,
	positiveInteger,
	requireRecord,
} from './measurement-admission.mjs';
import {
	assertCurrentConfigFinalQualification,
	assertPendingConfigDoesNotClaimQualification,
} from './milestone-6-qualification-state.mjs';
import { snapshotStrictJsonData } from './strict-json-snapshot.mjs';
import { evaluateQualityBudget } from '../quality-budget-evaluator.mjs';

export const MILESTONE_6_QUALIFICATION_EVIDENCE_PATH =
	'config/milestone-6-qualification-evidence.json';
export const MILESTONE_6_QUALIFICATION_EVIDENCE_ROOT = 'qualification/milestone-6';
export const MILESTONE_6_FIXED_PROFILE_ID = 'fixed-rtx3090';
export const MILESTONE_6_QUALIFICATION_PROFILE_IDS = Object.freeze([
	MILESTONE_6_FIXED_PROFILE_ID,
	...NATIVE_OS_LAB_PROFILES_V2.map(({ id }) => id),
]);

const QUALITY_BUDGET_PATH = 'config/quality-budgets.json';
const FIXED_ENVIRONMENT_ID = M6_REFERENCE_MASTER_ENVIRONMENT_IDS[0];
const REGISTER_FIELDS = Object.freeze([
	'schemaVersion', 'workloadId', 'evidenceRoot', 'status', 'blockedBy',
	'sourceRevision', 'budgetSha256', 'cohort', 'measurements',
]);
const PIN_FIELDS = Object.freeze(['path', 'byteLength', 'sha256']);
const MEASUREMENT_PIN_FIELDS = Object.freeze(['profileId', 'environmentId', ...PIN_FIELDS]);
const ACCEPTED_FIELDS = Object.freeze([
	'schemaVersion', 'workloadId', 'profileId', 'environmentId', 'sourceRevision',
	'budgetSha256', 'rendererClass', 'collection', 'packageBindings', 'labBinding', 'measurement',
]);
const COLLECTION_FIELDS = Object.freeze([
	'attemptCount', 'retryCount', 'hostedRunner', 'workloadRunnerSha256',
]);
const PACKAGE_FIELDS = Object.freeze([
	'productId', 'targetId', 'packageSha256', 'runtimeManifestSha256',
]);
const FIXED_FINGERPRINT_FIELDS = Object.freeze([
	'browserVersion', 'platform', 'architecture', 'webglVendor', 'webglRenderer',
	'gpuDriverVersion', 'gpuDeviceId', 'powerMode', 'displayMode',
]);
const TARGET_BY_PLATFORM = Object.freeze({
	windowsX64: 'win-x64',
	windowsArm64: 'win-arm64',
	macosArm64: 'mac-arm64',
	linuxX64: 'linux-x64',
	linuxArm64: 'linux-arm64',
});
const FIXED_PRODUCTS = Object.freeze(['soundscaper', 'framescaper']);
const SHA256 = /^[a-f0-9]{64}$/u;
const SOURCE_REVISION = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const MAXIMUM_EVIDENCE_BYTES = 256 * 1024 * 1024;
const AUDITED_QUALIFICATION = new WeakSet();
const execFileAsync = promisify(execFile);
const COLLECTION_CONTRACT = deepFreeze({
	attemptCount: 1,
	retryCount: 0,
	hostedRunner: false,
	timingWarmupTrials: 1,
	timingTrials: 5,
	metricIds: [...M6_REFERENCE_MASTER_METRIC_IDS],
});

const PROFILE_DEFINITIONS = deepFreeze([
	{
		id: MILESTONE_6_FIXED_PROFILE_ID,
		environmentId: FIXED_ENVIRONMENT_ID,
		productId: null,
		platformId: 'win32-x64',
	},
	...NATIVE_OS_LAB_PROFILES_V2.map((profile) => ({
		id: profile.id,
		environmentId: NATIVE_OS_LAB_ENVIRONMENT_ID,
		productId: profile.productId,
		platformId: profile.platformId,
	})),
]);

export async function readMilestone6QualificationEvidenceRegister(
	repositoryRoot,
	registerPath = MILESTONE_6_QUALIFICATION_EVIDENCE_PATH,
) {
	const root = boundedString(repositoryRoot, 1, 4_096, 'repository root');
	const path = boundedString(registerPath, 1, 4_096, 'qualification register path');
	return validateMilestone6QualificationEvidenceRegister(parseJson(
		await readFile(resolve(root, path)), path,
	));
}

export function validateMilestone6QualificationEvidenceRegister(value) {
	const register = exactRecord(
		snapshotStrictJsonData(value, 'Milestone 6 qualification evidence register'),
		REGISTER_FIELDS,
		'Milestone 6 qualification evidence register',
	);
	if (register.schemaVersion !== 1
		|| register.workloadId !== M6_REFERENCE_MASTER_WORKLOAD_ID
		|| register.evidenceRoot !== MILESTONE_6_QUALIFICATION_EVIDENCE_ROOT) {
		throw new Error('Milestone 6 qualification register identity is invalid.');
	}
	if (!Array.isArray(register.measurements)
		|| register.measurements.length !== PROFILE_DEFINITIONS.length) {
		throw new Error('Milestone 6 qualification register must enumerate the exact 19-profile matrix.');
	}
	const measurements = register.measurements.map((value, index) => {
		const descriptor = exactRecord(value, MEASUREMENT_PIN_FIELDS, `measurements[${index}]`);
		const definition = PROFILE_DEFINITIONS[index];
		if (descriptor.profileId !== definition.id
			|| descriptor.environmentId !== definition.environmentId) {
			throw new Error(`Milestone 6 measurement ${index} profile/environment order is not exact.`);
		}
		return descriptor;
	});
	const cohort = exactRecord(register.cohort, PIN_FIELDS, 'Milestone 6 cohort pin');
	if (register.status === 'pending-external') validatePendingRegister(register, cohort, measurements);
	else if (register.status === 'accepted') validateAcceptedRegister(register, cohort, measurements);
	else throw new Error('Milestone 6 qualification register status is unsupported.');
	return deepFreeze({
		...register,
		cohort: { ...cohort },
		measurements: measurements.map((descriptor) => ({ ...descriptor })),
	});
}

export async function auditMilestone6QualificationEvidence(optionsValue, dependencies = {}) {
	const options = requireRecord(optionsValue, 'Milestone 6 qualification audit options');
	const repositoryRoot = boundedString(
		options.repositoryRoot, 1, 4_096, 'Milestone 6 qualification repositoryRoot',
	);
	let register;
	let registerEvidence = null;
	if (options.register === undefined) {
		const path = options.registerPath ?? MILESTONE_6_QUALIFICATION_EVIDENCE_PATH;
		const bytes = await readFile(resolve(repositoryRoot, path));
		register = validateMilestone6QualificationEvidenceRegister(parseJson(bytes, path));
		registerEvidence = pin(path, bytes);
	} else register = validateMilestone6QualificationEvidenceRegister(options.register);
	const loadCurrentQualityBudget = dependencies.loadCurrentQualityBudget
		?? (() => readFile(resolve(repositoryRoot, QUALITY_BUDGET_PATH)));
	if (register.status === 'pending-external') {
		assertPendingConfigDoesNotClaimQualification(parseJson(
			await loadCurrentQualityBudget(), QUALITY_BUDGET_PATH,
		));
		return brandAudit({
			passed: true,
			qualificationReady: false,
			status: register.status,
			registerEvidence,
			workloadId: register.workloadId,
			sourceRevision: null,
			budgetSha256: null,
			requiredMeasurementCount: PROFILE_DEFINITIONS.length,
			auditedMeasurementCount: 0,
			blockers: [register.blockedBy],
			collectionContract: COLLECTION_CONTRACT,
			matrix: matrixSummary(register, 0),
			cohort: null,
		});
	}
	const loadHistoricalQualityBudget = dependencies.loadHistoricalQualityBudget
		?? ((revision) => loadHistoricalQualityBudgetFromGit(repositoryRoot, revision));
	const budgetBytes = evidenceBuffer(
		await loadHistoricalQualityBudget(register.sourceRevision),
		'historical quality budget',
	);
	if (sha256(budgetBytes) !== register.budgetSha256) {
		throw new Error('Milestone 6 historical budget digest does not match its register pin.');
	}
	const config = parseJson(budgetBytes, QUALITY_BUDGET_PATH);
	const usedPaths = new Set();
	const measurements = [];
	for (const descriptor of register.measurements) {
		assertUnusedPath(descriptor.path, usedPaths);
		const file = await readPinnedEvidence(repositoryRoot, descriptor, 'raw measurement');
		measurements.push(parseJson(file.bytes, descriptor.path));
	}
	const createCohort = dependencies.createMilestone6QualificationCohort
		?? createMilestone6QualificationCohort;
	const cohort = snapshotStrictJsonData(
		createCohort(measurements, config, register.budgetSha256),
		'Milestone 6 recomputed cohort',
	);
	if (cohort.sourceRevision !== register.sourceRevision
		|| cohort.budgetSha256 !== register.budgetSha256
		|| cohort.status !== 'accepted'
		|| cohort.qualificationEvidencePublished !== true
		|| cohort.evaluation?.passed !== true) {
		throw new Error('Milestone 6 recomputed cohort is not accepted qualification evidence.');
	}
	assertUnusedPath(register.cohort.path, usedPaths);
	const cohortFile = await readPinnedEvidence(repositoryRoot, register.cohort, 'cohort');
	const canonical = Buffer.from(`${JSON.stringify(cohort, null, '\t')}\n`, 'utf8');
	if (!cohortFile.bytes.equals(canonical)) {
		throw new Error('Milestone 6 cohort bytes do not match the recomputed canonical cohort.');
	}
	assertCurrentConfigFinalQualification(parseJson(
		await loadCurrentQualityBudget(), QUALITY_BUDGET_PATH,
	));
	return brandAudit({
		passed: true,
		qualificationReady: true,
		status: 'accepted',
		registerEvidence,
		workloadId: register.workloadId,
		sourceRevision: register.sourceRevision,
		budgetSha256: register.budgetSha256,
		requiredMeasurementCount: PROFILE_DEFINITIONS.length,
		auditedMeasurementCount: measurements.length,
		blockers: [],
		collectionContract: COLLECTION_CONTRACT,
		matrix: matrixSummary(register, measurements.length),
		cohort: deepFreeze(cohort),
	});
}

export function createMilestone6QualificationCohort(measurementsValue, configValue, budgetSha256Value) {
	if (!Array.isArray(measurementsValue)
		|| measurementsValue.length !== PROFILE_DEFINITIONS.length) {
		throw new Error('Milestone 6 accepted evidence requires the complete 19-profile matrix.');
	}
	const budgetSha256 = digest(budgetSha256Value, 'Milestone 6 budgetSha256');
	const context = qualificationContext(configValue);
	const packageDigests = new Map();
	let sourceRevision = null;
	const profiles = measurementsValue.map((value, index) => {
		const definition = PROFILE_DEFINITIONS[index];
		const accepted = validateAcceptedMeasurement(value, definition, context, budgetSha256);
		if (sourceRevision === null) sourceRevision = accepted.sourceRevision;
		else if (sourceRevision !== accepted.sourceRevision) {
			throw new Error('Milestone 6 accepted evidence must bind one source revision.');
		}
		validateConsistentPackages(accepted.packageBindings, packageDigests);
		const computed = computeM6ReferenceMasterMetrics(accepted.measurement, context.metricsContext);
		if (!isDeepStrictEqual(Object.keys(computed.metrics), [...M6_REFERENCE_MASTER_METRIC_IDS])) {
			throw new Error('Milestone 6 measurement did not derive the exact eleven registered metrics.');
		}
		const evaluation = evaluateQualityBudget({
			environmentId: definition.environmentId,
			rendererRequirement: context.environments.get(definition.environmentId).rendererRequirement,
			thresholds: context.workload.thresholds,
		}, context.environments.get(definition.environmentId), {
			environmentId: computed.environmentId,
			rendererClass: accepted.rendererClass,
			metrics: computed.metrics,
		});
		if (!evaluation.passed) {
			throw new Error(`Milestone 6 profile ${definition.id} failed: ${evaluation.failures.join(' ')}`);
		}
		return deepFreeze({
			profileId: definition.id,
			environmentId: definition.environmentId,
			platformId: computed.platformId,
			rendererClass: accepted.rendererClass,
			packageBindings: accepted.packageBindings,
			metrics: computed.metrics,
			rawSampleCounts: computed.rawSampleCounts,
			evaluation,
		});
	});
	return deepFreeze({
		schemaVersion: 1,
		status: 'accepted',
		workloadId: M6_REFERENCE_MASTER_WORKLOAD_ID,
		fixtureIds: [...M6_REFERENCE_MASTER_FIXTURE_IDS],
		environmentIds: [...M6_REFERENCE_MASTER_ENVIRONMENT_IDS],
		profileIds: [...MILESTONE_6_QUALIFICATION_PROFILE_IDS],
		sourceRevision,
		budgetSha256,
		qualificationEvidencePublished: true,
		profiles,
		evaluation: {
			passed: true,
			profileCount: profiles.length,
			metricCount: profiles.length * M6_REFERENCE_MASTER_METRIC_IDS.length,
		},
	});
}

export function isAuditedMilestone6QualificationEvidence(value) {
	return value !== null && typeof value === 'object' && AUDITED_QUALIFICATION.has(value);
}

function qualificationContext(configValue) {
	const config = requireRecord(configValue, 'historical quality config');
	const workload = exactDescriptor(config.workloads, M6_REFERENCE_MASTER_WORKLOAD_ID, 'workload');
	if (!isDeepStrictEqual(workload.fixtureIds, [...M6_REFERENCE_MASTER_FIXTURE_IDS])
		|| !isDeepStrictEqual(workload.environmentIds, [...M6_REFERENCE_MASTER_ENVIRONMENT_IDS])
		|| !isDeepStrictEqual(
			workload.thresholds?.map(({ metricId }) => metricId), [...M6_REFERENCE_MASTER_METRIC_IDS],
		)) throw new Error('Milestone 6 historical workload registration is not exact.');
	const fixtures = M6_REFERENCE_MASTER_FIXTURE_IDS.map((id) => exactDescriptor(config.fixtures, id, 'fixture'));
	const environments = new Map(M6_REFERENCE_MASTER_ENVIRONMENT_IDS.map((id) => [
		id, exactDescriptor(config.environments, id, 'environment'),
	]));
	const fixed = environments.get(FIXED_ENVIRONMENT_ID);
	const fixedFingerprint = exactRecord(
		fixed.fingerprint, FIXED_FINGERPRINT_FIELDS, 'Milestone 6 fixed RTX fingerprint',
	);
	for (const [field, value] of Object.entries(fixedFingerprint)) {
		boundedString(value, 1, 1_024, `Milestone 6 fixed RTX fingerprint.${field}`);
	}
	if (fixed.kind !== 'owner-qualified-packaged-runtime-fixed-gpu'
		|| fixed.status !== 'active' || fixed.qualificationEligible !== true
		|| fixed.rendererRequirement !== 'hardware'
		|| !fixed.eligibleWorkloadIds?.includes(M6_REFERENCE_MASTER_WORKLOAD_ID)) {
		throw new Error('Milestone 6 fixed RTX environment is not active and qualification-eligible.');
	}
	const native = validateNativeOsLabEnvironmentV2(environments.get(NATIVE_OS_LAB_ENVIRONMENT_ID));
	if (native.kind !== 'fixed-hardware-profile-matrix'
		|| Object.values(native.fingerprint).some((value) => value === null)) {
		throw new Error('Milestone 6 native environment kind/fingerprint is not qualification-ready.');
	}
	environments.set(NATIVE_OS_LAB_ENVIRONMENT_ID, native);
	if (fixtures.some(({ status }) => status !== 'qualification-ready')
		|| workload.status !== 'qualification-ready'
		|| config.qualification?.qualifiedWorkloadIds?.includes(M6_REFERENCE_MASTER_WORKLOAD_ID)) {
		throw new Error(
			'Milestone 6 measured candidate requires qualification-ready fixtures/workload '
			+ 'and must not claim final qualified registration.',
		);
	}
	return {
		workload,
		environments,
		metricsContext: {
			fixtureSpecification: fixtures[0].specification,
			fixtureCanvases: fixtures.map(({ specification }) => ({
				width: specification.videoWidth,
				height: specification.videoHeight,
			})),
			measurementPolicy: config.measurementPolicy,
		},
	};
}

function validateAcceptedMeasurement(value, definition, context, budgetSha256) {
	const accepted = exactRecord(
		snapshotStrictJsonData(value, `${definition.id} accepted measurement`),
		ACCEPTED_FIELDS,
		`${definition.id} accepted measurement`,
	);
	if (accepted.schemaVersion !== 2
		|| accepted.workloadId !== M6_REFERENCE_MASTER_WORKLOAD_ID
		|| accepted.profileId !== definition.id
		|| accepted.environmentId !== definition.environmentId
		|| accepted.budgetSha256 !== budgetSha256
		|| !SOURCE_REVISION.test(String(accepted.sourceRevision))) {
		throw new Error(`${definition.id} accepted measurement identity/source/budget binding is invalid.`);
	}
	if (!['hardware', 'software'].includes(accepted.rendererClass)) {
		throw new Error(`${definition.id} rendererClass is invalid.`);
	}
	const collection = exactRecord(accepted.collection, COLLECTION_FIELDS, `${definition.id} collection`);
	if (collection.attemptCount !== 1 || collection.retryCount !== 0 || collection.hostedRunner !== false) {
		throw new Error(`${definition.id} must be one owner-controlled attempt with no retries or hosted runner.`);
	}
	digest(collection.workloadRunnerSha256, `${definition.id} workload runner`);
	const packageBindings = validatePackageBindings(accepted.packageBindings, definition);
	const measurement = requireRecord(accepted.measurement, `${definition.id} measurement`);
	if (measurement.environmentId !== definition.environmentId
		|| measurement.platformId !== definition.platformId) {
		throw new Error(`${definition.id} measurement environment/platform binding is invalid.`);
	}
	if (definition.environmentId === FIXED_ENVIRONMENT_ID) {
		if (accepted.labBinding !== null || accepted.rendererClass !== 'hardware'
			|| !isDeepStrictEqual(measurement.fingerprint, context.environments.get(FIXED_ENVIRONMENT_ID).fingerprint)) {
			throw new Error(`${definition.id} fixed RTX environment fingerprint/hardware binding is invalid.`);
		}
	} else {
		const assessment = assessNativeOsLabBindingQualificationV2(
			context.environments.get(NATIVE_OS_LAB_ENVIRONMENT_ID),
			accepted.labBinding,
			M6_REFERENCE_MASTER_WORKLOAD_ID,
		);
		if (!assessment.provisioned) {
			throw new Error(`${definition.id} native environment is not qualified: ${assessment.blockers.join(' ')}`);
		}
		if (assessment.binding.profileId !== definition.id
			|| assessment.binding.platformId !== definition.platformId
			|| assessment.binding.profile.productId !== definition.productId
			|| assessment.binding.artifacts.sourceRevision !== accepted.sourceRevision
			|| assessment.binding.artifacts.packageSha256 !== packageBindings[0].packageSha256
			|| assessment.binding.artifacts.workloadRunnerSha256 !== collection.workloadRunnerSha256
			|| !isDeepStrictEqual(measurement.fingerprint, assessment.binding.physicalHost)) {
			throw new Error(`${definition.id} native host/package/source binding is invalid.`);
		}
	}
	return deepFreeze({ ...accepted, collection: { ...collection }, packageBindings, measurement });
}

function validatePackageBindings(value, definition) {
	if (!Array.isArray(value)) throw new Error(`${definition.id} packageBindings must be an array.`);
	const expected = definition.productId === null
		? FIXED_PRODUCTS.map((productId) => ({ productId, targetId: 'win-x64' }))
		: [{ productId: definition.productId, targetId: TARGET_BY_PLATFORM[definition.platformId] }];
	if (value.length !== expected.length) {
		throw new Error(`${definition.id} packageBindings do not cover its exact product/target set.`);
	}
	return deepFreeze(value.map((candidate, index) => {
		const binding = exactRecord(candidate, PACKAGE_FIELDS, `${definition.id} packageBindings[${index}]`);
		if (binding.productId !== expected[index].productId || binding.targetId !== expected[index].targetId) {
			throw new Error(`${definition.id} package binding identity/order is invalid.`);
		}
		digest(binding.packageSha256, `${definition.id} package SHA-256`);
		digest(binding.runtimeManifestSha256, `${definition.id} runtime manifest SHA-256`);
		return { ...binding };
	}));
}

function validateConsistentPackages(bindings, seen) {
	for (const binding of bindings) {
		const key = `${binding.productId}:${binding.targetId}`;
		const identity = `${binding.packageSha256}:${binding.runtimeManifestSha256}`;
		if (seen.has(key) && seen.get(key) !== identity) {
			throw new Error(`Milestone 6 ${key} package/runtime digest binding is inconsistent.`);
		}
		seen.set(key, identity);
	}
}

function validatePendingRegister(register, cohort, measurements) {
	boundedString(register.blockedBy, 1, 2_048, 'Milestone 6 pending blocker');
	if (register.sourceRevision !== null || register.budgetSha256 !== null
		|| Object.values(cohort).some((value) => value !== null)
		|| measurements.some(({ path, byteLength, sha256: value }) => (
			path !== null || byteLength !== null || value !== null
		))) throw new Error('Milestone 6 pending register must not claim accepted evidence pins.');
}

function validateAcceptedRegister(register, cohort, measurements) {
	if (register.blockedBy !== null || !SOURCE_REVISION.test(String(register.sourceRevision))) {
		throw new Error('Milestone 6 accepted register source revision/blocker is invalid.');
	}
	digest(register.budgetSha256, 'Milestone 6 accepted register budget SHA-256');
	validateAcceptedPin(cohort, 'Milestone 6 cohort');
	for (const descriptor of measurements) validateAcceptedPin(descriptor, `${descriptor.profileId} measurement`);
}

function validateAcceptedPin(value, label) {
	validateEvidencePath(value.path, label);
	positiveInteger(value.byteLength, `${label} byteLength`);
	if (value.byteLength > MAXIMUM_EVIDENCE_BYTES) throw new Error(`${label} exceeds the evidence byte limit.`);
	digest(value.sha256, `${label} SHA-256`);
}

async function readPinnedEvidence(repositoryRoot, descriptor, label) {
	validateEvidencePath(descriptor.path, label);
	const root = resolve(repositoryRoot);
	const absolutePath = resolve(root, descriptor.path);
	if (!isContainedPath(root, absolutePath)) throw new Error(`${label} path escapes the repository.`);
	const stats = await assertRegularNonSymbolicPath(root, absolutePath, label);
	if (stats.size !== descriptor.byteLength) throw new Error(`${label} byte length does not match its pin.`);
	const resolvedRoot = await realpath(root);
	const resolvedEvidenceRoot = await realpath(resolve(root, MILESTONE_6_QUALIFICATION_EVIDENCE_ROOT));
	const resolvedFile = await realpath(absolutePath);
	if (!isContainedPath(resolvedRoot, resolvedFile)
		|| !isContainedPath(resolvedEvidenceRoot, resolvedFile)) {
		throw new Error(`${label} path escapes the qualification evidence root.`);
	}
	const bytes = await readFile(absolutePath);
	if (bytes.byteLength !== descriptor.byteLength || sha256(bytes) !== descriptor.sha256) {
		throw new Error(`${label} byte length or digest does not match its pin.`);
	}
	return { bytes };
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

async function loadHistoricalQualityBudgetFromGit(repositoryRoot, sourceRevision) {
	if (!SOURCE_REVISION.test(sourceRevision)) throw new Error('Historical source revision is invalid.');
	const { stdout } = await execFileAsync(
		'git', ['show', `${sourceRevision}:${QUALITY_BUDGET_PATH}`],
		{ cwd: repositoryRoot, encoding: null, maxBuffer: 16 * 1024 * 1024 },
	);
	return stdout;
}

function validateEvidencePath(value, label) {
	const path = boundedString(value, 1, 4_096, `${label} path`);
	const prefix = `${MILESTONE_6_QUALIFICATION_EVIDENCE_ROOT}/`;
	if (isAbsolute(path) || path.includes('\\') || !path.startsWith(prefix) || path.endsWith('/')
		|| path.split('/').some((segment) => ['', '.', '..'].includes(segment))) {
		throw new Error(`${label} path must be canonical and repo-relative under ${MILESTONE_6_QUALIFICATION_EVIDENCE_ROOT}.`);
	}
	return path;
}

function exactDescriptor(values, id, label) {
	if (!Array.isArray(values)) throw new Error(`${label} registry must be an array.`);
	const matches = values.filter((candidate) => candidate?.id === id);
	if (matches.length !== 1) throw new Error(`${label} ${id} must occur exactly once.`);
	return requireRecord(matches[0], `${label} ${id}`);
}

function matrixSummary(register, auditedMeasurementCount) {
	return register.measurements.map((descriptor, index) => deepFreeze({
		profileId: descriptor.profileId,
		environmentId: descriptor.environmentId,
		productId: PROFILE_DEFINITIONS[index].productId,
		platformId: PROFILE_DEFINITIONS[index].platformId,
		packageTargets: PROFILE_DEFINITIONS[index].productId === null
			? FIXED_PRODUCTS.map((productId) => `${productId}:win-x64`)
			: [`${PROFILE_DEFINITIONS[index].productId}:${TARGET_BY_PLATFORM[PROFILE_DEFINITIONS[index].platformId]}`],
		status: register.status,
		audited: index < auditedMeasurementCount,
	}));
}

function brandAudit(value) {
	const audit = deepFreeze(value);
	AUDITED_QUALIFICATION.add(audit);
	return audit;
}

function pin(path, bytes) {
	return { path, byteLength: bytes.byteLength, sha256: sha256(bytes) };
}

function digest(value, label) {
	if (!SHA256.test(String(value))) throw new Error(`${label} is invalid.`);
	return value;
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
	if (paths.has(path)) throw new Error(`Milestone 6 evidence path ${path} is registered twice.`);
	paths.add(path);
}

function isContainedPath(root, candidate) {
	const fromRoot = relative(root, candidate);
	return fromRoot !== '' && !fromRoot.startsWith(`..${sep}`) && fromRoot !== '..' && !isAbsolute(fromRoot);
}

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}

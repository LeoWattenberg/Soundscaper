/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

import { createM9SoakCohort } from './m9-soak-evidence.mjs';
import { validateM9SoakSpec } from './m9-soak-fixture.mjs';
import {
	readSoundscaperStable1BehaviorEnvironmentMatrix,
	validateSoundscaperStable1BehaviorEnvironmentMatrix,
} from './soundscaper-stable-1-behavior-environments.mjs';
import {
	boundedString,
	deepFreeze,
	exactRecord,
	requireRecord,
} from './measurement-admission.mjs';
import { snapshotStrictJsonData } from './strict-json-snapshot.mjs';
import {
	validateSoundscaperStable1SoakEvidenceAuthority,
	validateSoundscaperStable1SoakTrustedKeyRegistry,
} from './soundscaper-stable-1-soak-attestation.mjs';

export const SOUNDSCAPER_STABLE_1_QUALIFICATION_EVIDENCE_PATH =
	'config/soundscaper-stable-1-qualification-evidence.json';
export const SOUNDSCAPER_STABLE_1_QUALIFICATION_EVIDENCE_ROOT = 'qualification/soundscaper-stable-1';

const QUALITY_BUDGET_PATH = 'config/quality-budgets.json';
const SOAK_SPEC_PATH = 'config/soundscaper-stable-1-soak-spec.json';
const REGISTER_FIELDS = Object.freeze([
	'schemaVersion', 'workloadId', 'fixtureId', 'behaviorMatrixId', 'evidenceRoot',
	'attestationProfileVersion', 'attestationProfileSha256', 'trustedLabKeyRegistrySha256',
	'workloadRunnerVersion',
	'status', 'blockedBy', 'sourceRevision', 'packageInventorySha256',
	'budgetSha256', 'soakSpecSha256', 'cells',
]);
const CELL_FIELDS = Object.freeze([
	'cellId', 'status', 'sourceRevision', 'packageInventorySha256', 'workloadRunnerSha256',
	'runs', 'cohort',
]);
const RUN_PIN_FIELDS = Object.freeze([
	'sequence', 'runId', 'sourceRevision', 'packageInventorySha256', 'workloadRunnerSha256',
	'path', 'byteLength', 'sha256',
]);
const PIN_FIELDS = Object.freeze(['path', 'byteLength', 'sha256']);
const SHA256 = /^[a-f0-9]{64}$/u;
const REVISION = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const MAXIMUM_EVIDENCE_BYTES = 256 * 1024 * 1024;
const execFileAsync = promisify(execFile);

export async function readSoundscaperStable1QualificationEvidenceRegister(
	repositoryRoot,
	registerPath = SOUNDSCAPER_STABLE_1_QUALIFICATION_EVIDENCE_PATH,
	matrixValue,
) {
	const root = boundedString(repositoryRoot, 1, 4_096, 'repository root');
	const matrix = matrixValue ?? await readSoundscaperStable1BehaviorEnvironmentMatrix(root);
	return validateSoundscaperStable1QualificationEvidenceRegister(JSON.parse(
		await readFile(resolve(root, registerPath), 'utf8'),
	), matrix);
}

export function validateSoundscaperStable1QualificationEvidenceRegister(value, matrixValue) {
	const matrix = validateSoundscaperStable1BehaviorEnvironmentMatrix(matrixValue);
	const register = exactRecord(
		snapshotStrictJsonData(value, 'Soundscaper Stable 1 qualification evidence register'),
		REGISTER_FIELDS,
		'Soundscaper Stable 1 qualification evidence register',
	);
	if (register.schemaVersion !== 2
		|| register.workloadId !== 'soundscaper-stable-1-complete-system-soak'
		|| register.fixtureId !== 'soundscaper-stable-1-complete-system-soak-8h-v1'
		|| register.behaviorMatrixId !== matrix.matrixId
		|| register.evidenceRoot !== SOUNDSCAPER_STABLE_1_QUALIFICATION_EVIDENCE_ROOT
		|| register.attestationProfileVersion !== 1
		|| !SHA256.test(register.attestationProfileSha256)
		|| !SHA256.test(register.trustedLabKeyRegistrySha256)
		|| register.workloadRunnerVersion !== '1.0.0'
		|| !SHA256.test(register.soakSpecSha256)) {
		throw new Error('Soundscaper Stable 1 qualification register identity is invalid.');
	}
	const requiredCells = matrix.cellSets.find(({ id }) => id === matrix.soakCellSetId).cellIds;
	if (!Array.isArray(register.cells) || register.cells.length !== requiredCells.length) {
		throw new Error('Soundscaper Stable 1 register must enumerate the exact release-runtime cell matrix.');
	}
	const cells = register.cells.map((value, index) => {
		const cell = exactRecord(value, CELL_FIELDS, `Soundscaper Stable 1 cells[${index}]`);
		if (cell.cellId !== requiredCells[index]) {
			throw new Error('Soundscaper Stable 1 register must enumerate the exact release-runtime cell matrix in order.');
		}
		if (!Array.isArray(cell.runs) || cell.runs.length !== 2) {
			throw new Error(`Soundscaper Stable 1 cell ${cell.cellId} must reserve exactly two runs.`);
		}
		const runs = cell.runs.map((runValue, runIndex) => {
			const run = exactRecord(runValue, RUN_PIN_FIELDS, `${cell.cellId} runs[${runIndex}]`);
			if (run.sequence !== runIndex + 1) throw new Error(`${cell.cellId} run sequence is not exact.`);
			return run;
		});
		const cohort = exactRecord(cell.cohort, PIN_FIELDS, `${cell.cellId} cohort`);
		return { ...cell, runs: runs.map((run) => ({ ...run })), cohort: { ...cohort } };
	});
	if (register.status === 'pending-external') validatePending(register, cells);
	else if (register.status === 'accepted') validateAccepted(register, cells);
	else throw new Error('Soundscaper Stable 1 qualification register status is unsupported.');
	return deepFreeze({ ...register, cells });
}

export async function auditSoundscaperStable1QualificationEvidence(optionsValue, dependencies = {}) {
	const options = requireRecord(optionsValue, 'Soundscaper Stable 1 qualification audit options');
	const repositoryRoot = boundedString(
		options.repositoryRoot, 1, 4_096, 'Soundscaper Stable 1 repositoryRoot',
	);
	const matrix = options.behaviorEnvironmentMatrix
		?? await readSoundscaperStable1BehaviorEnvironmentMatrix(repositoryRoot);
	const specBytes = options.soakSpecBytes
		?? await readFile(resolve(repositoryRoot, SOAK_SPEC_PATH));
	const spec = options.soakSpec ?? validateM9SoakSpec(parseJson(specBytes, SOAK_SPEC_PATH));
	const register = options.register
		?? await readSoundscaperStable1QualificationEvidenceRegister(repositoryRoot, undefined, matrix);
	const validated = validateSoundscaperStable1QualificationEvidenceRegister(register, matrix);
	if (sha256(specBytes) !== validated.soakSpecSha256) {
		throw new Error('Soundscaper Stable 1 soak specification digest does not match the register pin.');
	}
	const evidenceAuthority = validateSoundscaperStable1SoakEvidenceAuthority(spec.evidenceAuthority);
	assertAuthorityBinding(validated, evidenceAuthority);
	const loadTrustedKeyRegistry = dependencies.loadTrustedKeyRegistry
		?? (() => readAuthorityFile(repositoryRoot, evidenceAuthority.trustedKeyRegistry));
	const trustedKeyRegistryBytes = Buffer.from(await loadTrustedKeyRegistry());
	const trustedKeyRegistry = validateSoundscaperStable1SoakTrustedKeyRegistry(
		trustedKeyRegistryBytes, evidenceAuthority, validated.status === 'accepted',
	);
	const loadCurrentQualityBudget = dependencies.loadCurrentQualityBudget
		?? (() => readFile(resolve(repositoryRoot, QUALITY_BUDGET_PATH)));
	if (validated.status === 'pending-external') {
		assertPendingConfig(parseJson(await loadCurrentQualityBudget(), QUALITY_BUDGET_PATH));
		return deepFreeze({
			passed: true,
			qualificationReady: false,
			status: validated.status,
			workloadId: validated.workloadId,
				matrixId: validated.behaviorMatrixId,
				sourceRevision: null,
				packageInventorySha256: null,
				requiredCellCount: validated.cells.length,
			requiredRunCount: validated.cells.length * 2,
			auditedRunCount: 0,
			blockers: [validated.blockedBy, trustedKeyRegistry.blockedBy].filter(Boolean),
			cohorts: [],
		});
	}
	const loadHistoricalQualityBudget = dependencies.loadHistoricalQualityBudget
		?? ((revision) => loadHistoricalBudget(repositoryRoot, revision));
	const historicalBytes = Buffer.from(await loadHistoricalQualityBudget(validated.sourceRevision));
	if (sha256(historicalBytes) !== validated.budgetSha256) {
		throw new Error('Soundscaper Stable 1 historical quality budget digest does not match its register pin.');
	}
	const historical = parseJson(historicalBytes, QUALITY_BUDGET_PATH);
	const usedPaths = new Set();
	const cohorts = [];
	for (const cell of validated.cells) {
		const raws = [];
		for (const pin of cell.runs) {
			assertUnused(pin.path, usedPaths);
			const bytes = await readPinnedEvidence(repositoryRoot, pin, 'raw run');
			const raw = parseJson(bytes, pin.path);
			if (raw.matrixCellId !== cell.cellId || raw.sequence !== pin.sequence) {
				throw new Error(`Soundscaper Stable 1 raw run identity does not match cell ${cell.cellId}.`);
			}
			if (raw.sourceRevision !== pin.sourceRevision) {
				throw new Error(`Soundscaper Stable 1 raw run source revision does not match cell ${cell.cellId}.`);
			}
			if (raw.runId !== pin.runId) {
				throw new Error(`Soundscaper Stable 1 raw run identity does not match register pin ${cell.cellId}.`);
			}
			raws.push(raw);
		}
		const cohort = createM9SoakCohort(raws, {
			config: historical,
			spec,
			budgetSha256: validated.budgetSha256,
			trustedKeyRegistryBytes,
			evidenceBinding: {
				sourceRevision: validated.sourceRevision,
				packageInventorySha256: validated.packageInventorySha256,
				matrixCellId: cell.cellId,
				workloadRunnerVersion: validated.workloadRunnerVersion,
				workloadRunnerSha256: cell.workloadRunnerSha256,
				runs: cell.runs.map(({ sequence, runId }) => ({ sequence, runId })),
			},
		});
		assertUnused(cell.cohort.path, usedPaths);
		const cohortBytes = await readPinnedEvidence(repositoryRoot, cell.cohort, 'cohort');
		const canonical = Buffer.from(`${JSON.stringify(cohort, null, '\t')}\n`, 'utf8');
		if (!cohortBytes.equals(canonical)) {
			throw new Error(`Soundscaper Stable 1 cohort ${cell.cellId} does not match recomputed canonical evidence.`);
		}
		cohorts.push(cohort);
	}
	assertFinalConfig(parseJson(await loadCurrentQualityBudget(), QUALITY_BUDGET_PATH));
	return deepFreeze({
		passed: true,
		qualificationReady: true,
		status: 'accepted',
		workloadId: validated.workloadId,
		matrixId: validated.behaviorMatrixId,
		sourceRevision: validated.sourceRevision,
		packageInventorySha256: validated.packageInventorySha256,
		requiredCellCount: validated.cells.length,
		requiredRunCount: validated.cells.length * 2,
		auditedRunCount: validated.cells.length * 2,
		blockers: [],
		cohorts,
	});
}

function validatePending(register, cells) {
	if (typeof register.blockedBy !== 'string' || register.blockedBy.length === 0
		|| register.sourceRevision !== null || register.packageInventorySha256 !== null
		|| register.budgetSha256 !== null
		|| cells.some((cell) => cell.status !== 'pending-external'
				|| cell.sourceRevision !== null || cell.packageInventorySha256 !== null
				|| cell.workloadRunnerSha256 !== null
				|| cell.runs.some((run) => run.sourceRevision !== null
					|| run.runId !== null || run.packageInventorySha256 !== null
					|| run.workloadRunnerSha256 !== null || !emptyPin(run))
			|| !emptyPin(cell.cohort))) {
		throw new Error('Pending Soundscaper Stable 1 register must not claim evidence pins.');
	}
}

function validateAccepted(register, cells) {
	if (register.blockedBy !== null || !REVISION.test(register.sourceRevision ?? '')
		|| !SHA256.test(register.packageInventorySha256 ?? '')
		|| !SHA256.test(register.budgetSha256 ?? '')) {
		throw new Error('Soundscaper Stable 1 accepted identity/source revision is invalid.');
	}
	const runIds = [];
	for (const cell of cells) {
		if (cell.status !== 'accepted') throw new Error(`Soundscaper Stable 1 cell ${cell.cellId} is not accepted.`);
		if (cell.sourceRevision !== register.sourceRevision
			|| cell.runs.some((run) => run.sourceRevision !== register.sourceRevision)) {
			throw new Error(`Soundscaper Stable 1 cell ${cell.cellId} source revision is not candidate-bound.`);
		}
		if (cell.packageInventorySha256 !== register.packageInventorySha256
			|| cell.runs.some((run) => run.packageInventorySha256 !== register.packageInventorySha256)) {
			throw new Error(`Soundscaper Stable 1 cell ${cell.cellId} package inventory is not candidate-bound.`);
		}
		if (!SHA256.test(cell.workloadRunnerSha256 ?? '')
			|| cell.runs.some((run) => run.workloadRunnerSha256 !== cell.workloadRunnerSha256)) {
			throw new Error(`Soundscaper Stable 1 cell ${cell.cellId} workload runner digest is not bound.`);
		}
		if (cell.runs.some((run) => typeof run.runId !== 'string' || run.runId.length < 1
			|| run.runId.length > 128)
			|| new Set(cell.runs.map(({ runId }) => runId)).size !== cell.runs.length) {
			throw new Error(`Soundscaper Stable 1 cell ${cell.cellId} run identity is invalid.`);
		}
		runIds.push(...cell.runs.map(({ runId }) => runId));
		for (const pin of [...cell.runs, cell.cohort]) validatePin(pin, cell.cellId);
	}
	if (new Set(runIds).size !== runIds.length) {
		throw new Error('Soundscaper Stable 1 run identities must be globally unique.');
	}
}

function assertAuthorityBinding(register, authority) {
	if (register.attestationProfileVersion !== authority.profileVersion
		|| register.attestationProfileSha256 !== authority.profileSha256
		|| register.trustedLabKeyRegistrySha256 !== authority.trustedKeyRegistry.sha256
		|| register.workloadRunnerVersion !== authority.workloadRunner.version) {
		throw new Error('Soundscaper Stable 1 qualification register does not bind its soak evidence authority.');
	}
}

function emptyPin(pin) {
	return pin.path === null && pin.byteLength === null && pin.sha256 === null;
}

function validatePin(pin, label) {
	if (typeof pin.path !== 'string' || !pin.path.startsWith(`${SOUNDSCAPER_STABLE_1_QUALIFICATION_EVIDENCE_ROOT}/`)
		|| isAbsolute(pin.path) || pin.path.split('/').some((part) => part === '' || part === '.' || part === '..')
		|| !Number.isSafeInteger(pin.byteLength) || pin.byteLength < 1
		|| pin.byteLength > MAXIMUM_EVIDENCE_BYTES || !SHA256.test(pin.sha256 ?? '')) {
		throw new Error(`Soundscaper Stable 1 ${label} evidence pin is invalid.`);
	}
}

async function readPinnedEvidence(repositoryRoot, pin, label) {
	const root = await realpath(repositoryRoot);
	const path = resolve(root, pin.path);
	const relation = relative(root, path);
	if (relation === '' || relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
		throw new Error(`Soundscaper Stable 1 ${label} path escapes the repository.`);
	}
	const stats = await lstat(path);
	if (!stats.isFile() || stats.isSymbolicLink() || await realpath(path) !== path) {
		throw new Error(`Soundscaper Stable 1 ${label} must be a regular non-symbolic file path.`);
	}
	const bytes = await readFile(path);
	if (bytes.byteLength !== pin.byteLength || sha256(bytes) !== pin.sha256) {
		throw new Error(`Soundscaper Stable 1 ${label} byte length or digest does not match its pin.`);
	}
	return bytes;
}

async function readAuthorityFile(repositoryRoot, pin) {
	const root = await realpath(repositoryRoot);
	const path = resolve(root, pin.path);
	const relation = relative(root, path);
	if (relation === '' || relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
		throw new Error('Soundscaper Stable 1 trusted lab key registry path escapes the repository.');
	}
	const stats = await lstat(path);
	if (!stats.isFile() || stats.isSymbolicLink() || await realpath(path) !== path) {
		throw new Error('Soundscaper Stable 1 trusted lab key registry must be a regular non-symbolic file.');
	}
	const bytes = await readFile(path);
	if (bytes.byteLength !== pin.byteLength || sha256(bytes) !== pin.sha256) {
		throw new Error('Soundscaper Stable 1 trusted lab key registry does not match its pin.');
	}
	return bytes;
}

function assertPendingConfig(config) {
	if (config.qualification?.qualifiedWorkloadIds?.includes('soundscaper-stable-1-complete-system-soak')
		|| config.workloads?.find(({ id }) => id === 'soundscaper-stable-1-complete-system-soak')?.status === 'qualified') {
		throw new Error('Pending Soundscaper Stable 1 evidence cannot coexist with a qualified workload claim.');
	}
}

function assertFinalConfig(config) {
	const fixture = config.fixtures?.find(({ id }) => id === 'soundscaper-stable-1-complete-system-soak-8h-v1');
	const workload = config.workloads?.find(({ id }) => id === 'soundscaper-stable-1-complete-system-soak');
	if (fixture?.status !== 'qualified' || workload?.status !== 'qualified'
		|| !config.qualification?.qualifiedWorkloadIds?.includes('soundscaper-stable-1-complete-system-soak')) {
		throw new Error('Accepted Soundscaper Stable 1 evidence requires final current qualified registration.');
	}
}

function assertUnused(path, used) {
	if (used.has(path)) throw new Error(`Soundscaper Stable 1 evidence path ${path} is registered twice.`);
	used.add(path);
}

async function loadHistoricalBudget(repositoryRoot, revision) {
	const { stdout } = await execFileAsync(
		'git', ['show', `${revision}:${QUALITY_BUDGET_PATH}`],
		{ cwd: repositoryRoot, encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 },
	);
	return stdout;
}

function parseJson(bytes, path) {
	try {
		return JSON.parse(Buffer.from(bytes).toString('utf8'));
	} catch (error) {
		throw new Error(
			`${path} is invalid JSON: ${error instanceof Error ? error.message : String(error)}.`,
			{ cause: error },
		);
	}
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

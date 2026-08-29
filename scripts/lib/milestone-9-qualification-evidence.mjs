/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

import { createM9SoakCohort } from './m9-soak-evidence.mjs';
import { validateM9SoakSpec } from './m9-soak-fixture.mjs';
import {
	readMilestone9BehaviorEnvironmentMatrix,
	validateMilestone9BehaviorEnvironmentMatrix,
} from './milestone-9-behavior-environments.mjs';
import {
	boundedString,
	deepFreeze,
	exactRecord,
	requireRecord,
} from './measurement-admission.mjs';
import { snapshotStrictJsonData } from './strict-json-snapshot.mjs';

export const MILESTONE_9_QUALIFICATION_EVIDENCE_PATH =
	'config/milestone-9-qualification-evidence.json';
export const MILESTONE_9_QUALIFICATION_EVIDENCE_ROOT = 'qualification/milestone-9';

const QUALITY_BUDGET_PATH = 'config/quality-budgets.json';
const SOAK_SPEC_PATH = 'config/milestone-9-soak-spec.json';
const REGISTER_FIELDS = Object.freeze([
	'schemaVersion', 'workloadId', 'fixtureId', 'behaviorMatrixId', 'evidenceRoot',
	'status', 'blockedBy', 'sourceRevision', 'budgetSha256', 'soakSpecSha256', 'cells',
]);
const CELL_FIELDS = Object.freeze(['cellId', 'status', 'runs', 'cohort']);
const RUN_PIN_FIELDS = Object.freeze(['sequence', 'path', 'byteLength', 'sha256']);
const PIN_FIELDS = Object.freeze(['path', 'byteLength', 'sha256']);
const SHA256 = /^[a-f0-9]{64}$/u;
const REVISION = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const MAXIMUM_EVIDENCE_BYTES = 256 * 1024 * 1024;
const execFileAsync = promisify(execFile);

export async function readMilestone9QualificationEvidenceRegister(
	repositoryRoot,
	registerPath = MILESTONE_9_QUALIFICATION_EVIDENCE_PATH,
	matrixValue,
) {
	const root = boundedString(repositoryRoot, 1, 4_096, 'repository root');
	const matrix = matrixValue ?? await readMilestone9BehaviorEnvironmentMatrix(root);
	return validateMilestone9QualificationEvidenceRegister(JSON.parse(
		await readFile(resolve(root, registerPath), 'utf8'),
	), matrix);
}

export function validateMilestone9QualificationEvidenceRegister(value, matrixValue) {
	const matrix = validateMilestone9BehaviorEnvironmentMatrix(matrixValue);
	const register = exactRecord(
		snapshotStrictJsonData(value, 'Milestone 9 qualification evidence register'),
		REGISTER_FIELDS,
		'Milestone 9 qualification evidence register',
	);
	if (register.schemaVersion !== 1
		|| register.workloadId !== 'm9-complete-system-soak'
		|| register.fixtureId !== 'm9-complete-system-soak-8h-v1'
		|| register.behaviorMatrixId !== matrix.matrixId
		|| register.evidenceRoot !== MILESTONE_9_QUALIFICATION_EVIDENCE_ROOT
		|| !SHA256.test(register.soakSpecSha256)) {
		throw new Error('Milestone 9 qualification register identity is invalid.');
	}
	const requiredCells = matrix.cellSets.find(({ id }) => id === matrix.soakCellSetId).cellIds;
	if (!Array.isArray(register.cells) || register.cells.length !== requiredCells.length) {
		throw new Error('Milestone 9 register must enumerate the exact release-runtime cell matrix.');
	}
	const cells = register.cells.map((value, index) => {
		const cell = exactRecord(value, CELL_FIELDS, `Milestone 9 cells[${index}]`);
		if (cell.cellId !== requiredCells[index]) {
			throw new Error('Milestone 9 register must enumerate the exact release-runtime cell matrix in order.');
		}
		if (!Array.isArray(cell.runs) || cell.runs.length !== 2) {
			throw new Error(`Milestone 9 cell ${cell.cellId} must reserve exactly two runs.`);
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
	else throw new Error('Milestone 9 qualification register status is unsupported.');
	return deepFreeze({ ...register, cells });
}

export async function auditMilestone9QualificationEvidence(optionsValue, dependencies = {}) {
	const options = requireRecord(optionsValue, 'Milestone 9 qualification audit options');
	const repositoryRoot = boundedString(
		options.repositoryRoot, 1, 4_096, 'Milestone 9 repositoryRoot',
	);
	const matrix = options.behaviorEnvironmentMatrix
		?? await readMilestone9BehaviorEnvironmentMatrix(repositoryRoot);
	const specBytes = options.soakSpecBytes
		?? await readFile(resolve(repositoryRoot, SOAK_SPEC_PATH));
	const spec = options.soakSpec ?? validateM9SoakSpec(parseJson(specBytes, SOAK_SPEC_PATH));
	const register = options.register
		?? await readMilestone9QualificationEvidenceRegister(repositoryRoot, undefined, matrix);
	const validated = validateMilestone9QualificationEvidenceRegister(register, matrix);
	if (sha256(specBytes) !== validated.soakSpecSha256) {
		throw new Error('Milestone 9 soak specification digest does not match the register pin.');
	}
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
			requiredCellCount: validated.cells.length,
			requiredRunCount: validated.cells.length * 2,
			auditedRunCount: 0,
			blockers: [validated.blockedBy],
			cohorts: [],
		});
	}
	const loadHistoricalQualityBudget = dependencies.loadHistoricalQualityBudget
		?? ((revision) => loadHistoricalBudget(repositoryRoot, revision));
	const historicalBytes = Buffer.from(await loadHistoricalQualityBudget(validated.sourceRevision));
	if (sha256(historicalBytes) !== validated.budgetSha256) {
		throw new Error('Milestone 9 historical quality budget digest does not match its register pin.');
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
				throw new Error(`Milestone 9 raw run identity does not match cell ${cell.cellId}.`);
			}
			raws.push(raw);
		}
		const cohort = createM9SoakCohort(raws, {
			config: historical,
			spec,
			budgetSha256: validated.budgetSha256,
		});
		assertUnused(cell.cohort.path, usedPaths);
		const cohortBytes = await readPinnedEvidence(repositoryRoot, cell.cohort, 'cohort');
		const canonical = Buffer.from(`${JSON.stringify(cohort, null, '\t')}\n`, 'utf8');
		if (!cohortBytes.equals(canonical)) {
			throw new Error(`Milestone 9 cohort ${cell.cellId} does not match recomputed canonical evidence.`);
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
		requiredCellCount: validated.cells.length,
		requiredRunCount: validated.cells.length * 2,
		auditedRunCount: validated.cells.length * 2,
		blockers: [],
		cohorts,
	});
}

function validatePending(register, cells) {
	if (typeof register.blockedBy !== 'string' || register.blockedBy.length === 0
		|| register.sourceRevision !== null || register.budgetSha256 !== null
		|| cells.some((cell) => cell.status !== 'pending-external'
			|| cell.runs.some((run) => !emptyPin(run)) || !emptyPin(cell.cohort))) {
		throw new Error('Pending Milestone 9 register must not claim evidence pins.');
	}
}

function validateAccepted(register, cells) {
	if (register.blockedBy !== null || !REVISION.test(register.sourceRevision ?? '')
		|| !SHA256.test(register.budgetSha256 ?? '')) {
		throw new Error('Milestone 9 accepted identity/source revision is invalid.');
	}
	for (const cell of cells) {
		if (cell.status !== 'accepted') throw new Error(`Milestone 9 cell ${cell.cellId} is not accepted.`);
		for (const pin of [...cell.runs, cell.cohort]) validatePin(pin, cell.cellId);
	}
}

function emptyPin(pin) {
	return pin.path === null && pin.byteLength === null && pin.sha256 === null;
}

function validatePin(pin, label) {
	if (typeof pin.path !== 'string' || !pin.path.startsWith(`${MILESTONE_9_QUALIFICATION_EVIDENCE_ROOT}/`)
		|| isAbsolute(pin.path) || pin.path.split('/').some((part) => part === '' || part === '.' || part === '..')
		|| !Number.isSafeInteger(pin.byteLength) || pin.byteLength < 1
		|| pin.byteLength > MAXIMUM_EVIDENCE_BYTES || !SHA256.test(pin.sha256 ?? '')) {
		throw new Error(`Milestone 9 ${label} evidence pin is invalid.`);
	}
}

async function readPinnedEvidence(repositoryRoot, pin, label) {
	const root = await realpath(repositoryRoot);
	const path = resolve(root, pin.path);
	const relation = relative(root, path);
	if (relation === '' || relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
		throw new Error(`Milestone 9 ${label} path escapes the repository.`);
	}
	const stats = await lstat(path);
	if (!stats.isFile() || stats.isSymbolicLink() || await realpath(path) !== path) {
		throw new Error(`Milestone 9 ${label} must be a regular non-symbolic file path.`);
	}
	const bytes = await readFile(path);
	if (bytes.byteLength !== pin.byteLength || sha256(bytes) !== pin.sha256) {
		throw new Error(`Milestone 9 ${label} byte length or digest does not match its pin.`);
	}
	return bytes;
}

function assertPendingConfig(config) {
	if (config.qualification?.qualifiedWorkloadIds?.includes('m9-complete-system-soak')
		|| config.workloads?.find(({ id }) => id === 'm9-complete-system-soak')?.status === 'qualified') {
		throw new Error('Pending Milestone 9 evidence cannot coexist with a qualified workload claim.');
	}
}

function assertFinalConfig(config) {
	const fixture = config.fixtures?.find(({ id }) => id === 'm9-complete-system-soak-8h-v1');
	const workload = config.workloads?.find(({ id }) => id === 'm9-complete-system-soak');
	if (fixture?.status !== 'qualified' || workload?.status !== 'qualified'
		|| !config.qualification?.qualifiedWorkloadIds?.includes('m9-complete-system-soak')) {
		throw new Error('Accepted Milestone 9 evidence requires final current qualified registration.');
	}
}

function assertUnused(path, used) {
	if (used.has(path)) throw new Error(`Milestone 9 evidence path ${path} is registered twice.`);
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

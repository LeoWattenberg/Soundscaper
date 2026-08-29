/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
	MILESTONE_9_EXPECTED_CHECK_IDS,
	MILESTONE_9_EXPECTED_PREFIX_COUNTS,
} from './milestone-9-check-inventory.mjs';
import {
	boundedString,
	deepFreeze,
	exactRecord,
} from './measurement-admission.mjs';
import { snapshotStrictJsonData } from './strict-json-snapshot.mjs';

export const MILESTONE_9_BEHAVIOR_ENVIRONMENT_PATH =
	'config/milestone-9-behavior-environments.json';

const MATRIX_FIELDS = Object.freeze([
	'schemaVersion', 'matrixId', 'releaseVersion', 'soakCellSetId', 'cells', 'cellSets',
	'defaultCellSetByPrefix', 'overrides',
]);
const CELL_FIELDS = Object.freeze(['id', 'kind', 'platformId', 'productId', 'versionBand']);
const CELL_SET_FIELDS = Object.freeze(['id', 'cellIds']);
const OVERRIDE_FIELDS = Object.freeze(['checkId', 'cellSetId']);
const CELL_KINDS = Object.freeze([
	'browser', 'desktop', 'native-profile', 'fixed-qualification-profile', 'review',
]);
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const RUN_REFERENCES = /(?:^|\s)run:(?<id>[A-Za-z0-9._-]+)/gu;
const CELL_REFERENCES = /(?:^|\s)cell:(?<id>[a-z0-9]+(?:-[a-z0-9]+)*)/gu;

export async function readMilestone9BehaviorEnvironmentMatrix(
	repositoryRoot,
	path = MILESTONE_9_BEHAVIOR_ENVIRONMENT_PATH,
) {
	return validateMilestone9BehaviorEnvironmentMatrix(JSON.parse(
		await readFile(resolve(repositoryRoot, path), 'utf8'),
	));
}

export function validateMilestone9BehaviorEnvironmentMatrix(value) {
	const matrix = exactRecord(
		snapshotStrictJsonData(value, 'Milestone 9 behavior environment matrix'),
		MATRIX_FIELDS,
		'Milestone 9 behavior environment matrix',
	);
	if (matrix.schemaVersion !== 1 || matrix.releaseVersion !== '1.0.0') {
		throw new Error('Milestone 9 behavior environment matrix identity is invalid.');
	}
	identifier(matrix.matrixId, 'matrixId');
	identifier(matrix.soakCellSetId, 'soakCellSetId');
	const cells = denseArray(matrix.cells, 'Milestone 9 cells').map((value, index) => {
		const cell = exactRecord(value, CELL_FIELDS, `Milestone 9 cells[${index}]`);
		identifier(cell.id, `cells[${index}].id`);
		if (!CELL_KINDS.includes(cell.kind)) throw new Error(`Milestone 9 cell ${cell.id} has an invalid kind.`);
		nullableToken(cell.platformId, `cells[${index}].platformId`);
		if (cell.productId !== null && !['soundscaper', 'framescaper'].includes(cell.productId)) {
			throw new Error(`Milestone 9 cell ${cell.id} has an invalid productId.`);
		}
		if (cell.versionBand !== null && !['current', 'previous'].includes(cell.versionBand)) {
			throw new Error(`Milestone 9 cell ${cell.id} has an invalid versionBand.`);
		}
		return cell;
	});
	assertUnique(cells.map(({ id }) => id), 'Milestone 9 cell IDs');
	const cellIds = new Set(cells.map(({ id }) => id));
	const cellSets = denseArray(matrix.cellSets, 'Milestone 9 cell sets').map((value, index) => {
		const cellSet = exactRecord(value, CELL_SET_FIELDS, `Milestone 9 cellSets[${index}]`);
		identifier(cellSet.id, `cellSets[${index}].id`);
		const members = stringArray(cellSet.cellIds, `cellSets[${index}].cellIds`);
		assertUnique(members, `Milestone 9 cell set ${cellSet.id} members`);
		for (const cellId of members) {
			if (!cellIds.has(cellId)) throw new Error(`Milestone 9 cell set ${cellSet.id} names unknown cell ${cellId}.`);
		}
		return { ...cellSet, cellIds: members };
	});
	assertUnique(cellSets.map(({ id }) => id), 'Milestone 9 cell set IDs');
	const cellSetById = new Map(cellSets.map((cellSet) => [cellSet.id, cellSet]));
	if (!cellSetById.has(matrix.soakCellSetId)) throw new Error('Milestone 9 soak cell set is unknown.');
	const soakCells = matrixCellSet(cellSetById, matrix.soakCellSetId);
	const expectedSoakCells = cells.filter(({ kind }) => ['browser', 'desktop'].includes(kind)).map(({ id }) => id);
	if (JSON.stringify(soakCells) !== JSON.stringify(expectedSoakCells)) {
		throw new Error('Milestone 9 soak cell set must be the exact browser and five-desktop matrix.');
	}
	const defaults = exactRecord(
		matrix.defaultCellSetByPrefix,
		Object.keys(MILESTONE_9_EXPECTED_PREFIX_COUNTS),
		'Milestone 9 default cell sets',
	);
	for (const [prefix, cellSetId] of Object.entries(defaults)) {
		if (!cellSetById.has(cellSetId)) throw new Error(`Milestone 9 prefix ${prefix} names an unknown cell set.`);
	}
	const overrides = denseArray(matrix.overrides, 'Milestone 9 overrides', true).map((value, index) => {
		const override = exactRecord(value, OVERRIDE_FIELDS, `Milestone 9 overrides[${index}]`);
		if (!MILESTONE_9_EXPECTED_CHECK_IDS.includes(override.checkId)) {
			throw new Error(`Milestone 9 override names unknown check ${override.checkId}.`);
		}
		if (!cellSetById.has(override.cellSetId)) {
			throw new Error(`Milestone 9 override ${override.checkId} names an unknown cell set.`);
		}
		return override;
	});
	assertUnique(overrides.map(({ checkId }) => checkId), 'Milestone 9 override check IDs');
	const validated = deepFreeze({
		...matrix,
		cells: cells.map((cell) => ({ ...cell })),
		cellSets: cellSets.map((cellSet) => ({ ...cellSet, cellIds: [...cellSet.cellIds] })),
		defaultCellSetByPrefix: { ...defaults },
		overrides: overrides.map((override) => ({ ...override })),
	});
	expandMilestone9BehaviorEnvironmentRequirements(validated);
	return validated;
}

export function expandMilestone9BehaviorEnvironmentRequirements(matrixValue) {
	const matrix = matrixValue?.schemaVersion === 1 && Object.isFrozen(matrixValue)
		? matrixValue
		: validateMilestone9BehaviorEnvironmentMatrix(matrixValue);
	const cellSets = new Map(matrix.cellSets.map((cellSet) => [cellSet.id, cellSet.cellIds]));
	const overrides = new Map(matrix.overrides.map(({ checkId, cellSetId }) => [checkId, cellSetId]));
	const requirements = new Map();
	for (const checkId of MILESTONE_9_EXPECTED_CHECK_IDS) {
		const prefix = checkId.slice(0, checkId.indexOf('-'));
		const cellSetId = overrides.get(checkId) ?? matrix.defaultCellSetByPrefix[prefix];
		const cellIds = cellSets.get(cellSetId);
		if (!Array.isArray(cellIds) || cellIds.length === 0) {
			throw new Error(`Milestone 9 check ${checkId} has no applicable environment cells.`);
		}
		requirements.set(checkId, Object.freeze([...cellIds]));
	}
	return requirements;
}

export function evaluateMilestone9BehaviorEnvironmentCoverage(parsed, matrixValue) {
	const matrix = validateMilestone9BehaviorEnvironmentMatrix(matrixValue);
	const requirements = expandMilestone9BehaviorEnvironmentRequirements(matrix);
	const knownCells = new Set(matrix.cells.map(({ id }) => id));
	const reasons = [];
	const runCells = new Map();
	for (const execution of parsed.executions) {
		const cells = [...execution.environment.matchAll(CELL_REFERENCES)].map(({ groups }) => groups.id);
		if (cells.length !== 1) {
			reasons.push(`Execution ${execution.runId} must cite exactly one cell:<environment-id>.`);
			continue;
		}
		if (!knownCells.has(cells[0])) {
			reasons.push(`Execution ${execution.runId} cites unknown environment cell ${cells[0]}.`);
			continue;
		}
		runCells.set(execution.runId, cells[0]);
	}
	const missingCells = [];
	const unexpectedCells = [];
	for (const row of parsed.rows) {
		if (!['pass', 'fail'].includes(row.result)) continue;
		const required = new Set(requirements.get(row.id) ?? []);
		const citedCells = new Set([...row.notes.matchAll(RUN_REFERENCES)]
			.map(({ groups }) => runCells.get(groups.id)).filter(Boolean));
		for (const cellId of required) {
			if (!citedCells.has(cellId)) missingCells.push({ checkId: row.id, cellId });
		}
		for (const cellId of citedCells) {
			if (!required.has(cellId)) unexpectedCells.push({ checkId: row.id, cellId });
		}
	}
	for (const { checkId, cellId } of missingCells) {
		reasons.push(`${checkId} has no cited execution for required environment cell ${cellId}.`);
	}
	for (const { checkId, cellId } of unexpectedCells) {
		reasons.push(`${checkId} cites non-applicable environment cell ${cellId}.`);
	}
	return deepFreeze({
		passed: reasons.length === 0,
		matrixId: matrix.matrixId,
		requiredBehaviorCount: requirements.size,
		requiredCellCount: [...requirements.values()].reduce((total, cellIds) => total + cellIds.length, 0),
		missingCells,
		unexpectedCells,
		reasons,
	});
}

function matrixCellSet(cellSets, id) {
	return cellSets.get(id)?.cellIds ?? [];
}

function denseArray(value, path, allowEmpty = false) {
	if (!Array.isArray(value) || (!allowEmpty && value.length === 0)
		|| Reflect.ownKeys(value).length !== value.length + 1) {
		throw new Error(`${path} must be a ${allowEmpty ? '' : 'non-empty '}dense array.`);
	}
	return value;
}

function stringArray(value, path) {
	return denseArray(value, path).map((item, index) => identifier(item, `${path}[${index}]`));
}

function identifier(value, path) {
	boundedString(value, 1, 128, path);
	if (!ID.test(value)) throw new Error(`${path} must be a lowercase identifier.`);
	return value;
}

function nullableToken(value, path) {
	if (value === null) return;
	boundedString(value, 1, 128, path);
	if (!/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/u.test(value)) {
		throw new Error(`${path} must be a bounded token.`);
	}
}

function assertUnique(values, path) {
	if (new Set(values).size !== values.length) throw new Error(`${path} must be unique.`);
}

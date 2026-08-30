/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
	SOUNDSCAPER_STABLE_1_EXPECTED_CHECK_IDS,
	SOUNDSCAPER_STABLE_1_EXPECTED_PREFIXES,
} from './soundscaper-stable-1-check-inventory.mjs';

export const SOUNDSCAPER_STABLE_1_BEHAVIOR_ENVIRONMENT_PATH =
	'config/soundscaper-stable-1-behavior-environments.json';

const MATRIX_FIELDS = Object.freeze([
	'schemaVersion', 'matrixId', 'productId', 'releaseVersion', 'soakCellSetId', 'cells',
	'cellSets', 'defaultCellSetByPrefix', 'overrides',
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

export async function readSoundscaperStable1BehaviorEnvironmentMatrix(
	repositoryRoot,
	path = SOUNDSCAPER_STABLE_1_BEHAVIOR_ENVIRONMENT_PATH,
) {
	return validateSoundscaperStable1BehaviorEnvironmentMatrix(JSON.parse(
		await readFile(resolve(repositoryRoot, path), 'utf8'),
	));
}

export function validateSoundscaperStable1BehaviorEnvironmentMatrix(value) {
	const matrix = exactRecord(clone(value), MATRIX_FIELDS, 'Soundscaper Stable 1 behavior matrix');
	if (matrix.schemaVersion !== 1 || matrix.productId !== 'soundscaper'
		|| matrix.releaseVersion !== '1.0.0') {
		throw new Error('Soundscaper Stable 1 behavior matrix identity is invalid.');
	}
	identifier(matrix.matrixId, 'matrixId');
	identifier(matrix.soakCellSetId, 'soakCellSetId');
	const cells = denseArray(matrix.cells, 'Soundscaper Stable 1 cells').map((value, index) => {
		const cell = exactRecord(value, CELL_FIELDS, `Soundscaper Stable 1 cells[${index}]`);
		identifier(cell.id, `cells[${index}].id`);
		if (!CELL_KINDS.includes(cell.kind)) throw new Error(`Cell ${cell.id} has an invalid kind.`);
		nullableToken(cell.platformId, `cells[${index}].platformId`);
		if (cell.productId !== null && cell.productId !== 'soundscaper') {
			throw new Error(`Cell ${cell.id} introduces a foreign product runtime.`);
		}
		if (cell.versionBand !== null && !['current', 'previous'].includes(cell.versionBand)) {
			throw new Error(`Cell ${cell.id} has an invalid versionBand.`);
		}
		return { ...cell };
	});
	assertUnique(cells.map(({ id }) => id), 'cell IDs');
	const cellIds = new Set(cells.map(({ id }) => id));
	const cellSets = denseArray(matrix.cellSets, 'Soundscaper Stable 1 cell sets')
		.map((value, index) => {
			const cellSet = exactRecord(value, CELL_SET_FIELDS, `cellSets[${index}]`);
			identifier(cellSet.id, `cellSets[${index}].id`);
			const members = stringArray(cellSet.cellIds, `cellSets[${index}].cellIds`);
			assertUnique(members, `cell set ${cellSet.id} members`);
			for (const cellId of members) {
				if (!cellIds.has(cellId)) throw new Error(`Cell set ${cellSet.id} names unknown cell ${cellId}.`);
			}
			return { ...cellSet, cellIds: members };
		});
	assertUnique(cellSets.map(({ id }) => id), 'cell set IDs');
	const cellSetById = new Map(cellSets.map((cellSet) => [cellSet.id, cellSet]));
	if (!cellSetById.has(matrix.soakCellSetId)) throw new Error('The soak cell set is unknown.');
	const expectedSoakCells = cells.filter(({ kind }) => ['browser', 'desktop'].includes(kind))
		.map(({ id }) => id);
	if (JSON.stringify(cellSetById.get(matrix.soakCellSetId).cellIds)
		!== JSON.stringify(expectedSoakCells)) {
		throw new Error('The soak cell set must be the exact browser and five-desktop matrix.');
	}
	const defaults = exactRecord(matrix.defaultCellSetByPrefix,
		SOUNDSCAPER_STABLE_1_EXPECTED_PREFIXES, 'Soundscaper Stable 1 default cell sets');
	for (const [prefix, cellSetId] of Object.entries(defaults)) {
		if (!cellSetById.has(cellSetId)) throw new Error(`Prefix ${prefix} names an unknown cell set.`);
	}
	const overrides = denseArray(matrix.overrides, 'Soundscaper Stable 1 overrides', true)
		.map((value, index) => {
			const override = exactRecord(value, OVERRIDE_FIELDS, `overrides[${index}]`);
			if (!SOUNDSCAPER_STABLE_1_EXPECTED_CHECK_IDS.includes(override.checkId)) {
				throw new Error(`Override names unknown check ${override.checkId}.`);
			}
			if (!cellSetById.has(override.cellSetId)) {
				throw new Error(`Override ${override.checkId} names an unknown cell set.`);
			}
			return { ...override };
		});
	assertUnique(overrides.map(({ checkId }) => checkId), 'override check IDs');
	const validated = deepFreeze({
		...matrix,
		cells,
		cellSets,
		defaultCellSetByPrefix: { ...defaults },
		overrides,
	});
	expandSoundscaperStable1BehaviorEnvironmentRequirements(validated);
	return validated;
}

export function expandSoundscaperStable1BehaviorEnvironmentRequirements(matrixValue) {
	const matrix = matrixValue?.schemaVersion === 1 && Object.isFrozen(matrixValue)
		? matrixValue
		: validateSoundscaperStable1BehaviorEnvironmentMatrix(matrixValue);
	const cellSets = new Map(matrix.cellSets.map(({ id, cellIds }) => [id, cellIds]));
	const overrides = new Map(matrix.overrides.map(({ checkId, cellSetId }) => [checkId, cellSetId]));
	const requirements = new Map();
	for (const checkId of SOUNDSCAPER_STABLE_1_EXPECTED_CHECK_IDS) {
		const prefix = checkId.slice(0, checkId.indexOf('-'));
		const cellIds = cellSets.get(overrides.get(checkId) ?? matrix.defaultCellSetByPrefix[prefix]);
		if (!Array.isArray(cellIds) || cellIds.length === 0) {
			throw new Error(`Soundscaper Stable 1 check ${checkId} has no environment cells.`);
		}
		requirements.set(checkId, Object.freeze([...cellIds]));
	}
	return requirements;
}

export function evaluateSoundscaperStable1BehaviorEnvironmentCoverage(parsed, matrixValue) {
	const matrix = validateSoundscaperStable1BehaviorEnvironmentMatrix(matrixValue);
	const requirements = expandSoundscaperStable1BehaviorEnvironmentRequirements(matrix);
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
		const cited = new Set([...row.notes.matchAll(RUN_REFERENCES)]
			.map(({ groups }) => runCells.get(groups.id)).filter(Boolean));
		for (const cellId of required) if (!cited.has(cellId)) missingCells.push({ checkId: row.id, cellId });
		for (const cellId of cited) if (!required.has(cellId)) unexpectedCells.push({ checkId: row.id, cellId });
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
		requiredCellCount: [...requirements.values()].reduce((total, ids) => total + ids.length, 0),
		missingCells,
		unexpectedCells,
		reasons,
	});
}

function exactRecord(value, fields, label) {
	if (value === null || typeof value !== 'object' || Array.isArray(value)
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...fields].sort())) {
		throw new Error(`${label} must have exact fields: ${fields.join(', ')}.`);
	}
	return value;
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
	if (typeof value !== 'string' || value.length < 1 || value.length > 128 || !ID.test(value)) {
		throw new Error(`${path} must be a lowercase identifier.`);
	}
	return value;
}

function nullableToken(value, path) {
	if (value === null) return;
	if (typeof value !== 'string' || value.length < 1 || value.length > 128
		|| !/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/u.test(value)) {
		throw new Error(`${path} must be a bounded token.`);
	}
}

function assertUnique(values, path) {
	if (new Set(values).size !== values.length) throw new Error(`${path} must be unique.`);
}

function clone(value) {
	try {
		return structuredClone(value);
	} catch (error) {
		throw new Error('Soundscaper Stable 1 behavior matrix must be strict JSON data.', { cause: error });
	}
}

function deepFreeze(value) {
	for (const child of Object.values(value)) {
		if (child !== null && typeof child === 'object' && !Object.isFrozen(child)) deepFreeze(child);
	}
	return Object.freeze(value);
}

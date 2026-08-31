/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed, non-activating catalog tasks for the remaining Milestone 7 model supply. */

import {
	validateMilestone7ConversionExecutionRegister,
} from './milestone-7-conversion-execution.mjs';
import {
	validateMilestone7ModelSupplyRegister,
	validateMilestone7ParityFixtureRegister,
} from './milestone-7-model-supply.mjs';
import {
	validateMilestone7RuntimeSupplyRegister,
} from './milestone-7-runtime-supply.mjs';

const GIB = 1024 ** 3;
const SHA256 = /^[a-f\d]{64}$/u;
const IDENTIFIER = /^[a-z\d][a-z\d.-]*[a-z\d]$/u;
const FILE_NAME = /^[A-Za-z\d][A-Za-z\d._-]{0,159}$/u;
const SOURCE_FILE_NAME = /^[A-Za-z\d][A-Za-z\d._/-]{0,255}$/u;
const FIVE_PLATFORMS = Object.freeze([
	'darwin-arm64', 'linux-x64', 'linux-arm64', 'win32-x64', 'win32-arm64',
]);

const TASKS = Object.freeze([
	direct('wav2vec2-base-960h', '1.0.0', 'word-alignment', 'baseline',
		'wav2vec2-base-960h-english-alignment', 'onnxruntime-node', 4 * GIB,
		'model', 'onnx/model.onnx', 'model.onnx'),
	derived('tiger-dnr', '1.0.0', 'source-separation', 'baseline',
		'tiger-dnr-neural-core', 'network', 4 * GIB,
		'network', 'tiger-dnr.onnx', 'network.onnx'),
	derived('panns-cnn10', '1.0.0', 'audio-tagging', 'baseline',
		'panns-cnn10', 'network', 2 * GIB,
		'panns-cnn10', 'panns-cnn10.onnx', 'panns-cnn10.onnx',
		['audioset-class-map']),
	derived('beat-this-small0', '1.1.0', 'beat-tracking', 'baseline',
		'beat-this', 'small0-network', 2 * GIB,
		'beat-this-small0', 'beat-this-small0.onnx', 'beat-this-small0.onnx'),
	derived('beat-this-final0', '1.1.0', 'beat-tracking', 'optional-quality',
		'beat-this', 'final0-network', 4 * GIB,
		'beat-this-final0', 'beat-this-final0.onnx', 'beat-this-final0.onnx'),
	derived('transnetv2', '1.0.0', 'shot-detection', 'baseline',
		'transnetv2', 'network', 2 * GIB,
		'network', 'transnetv2.onnx', 'network.onnx'),
	direct('qwen3-4b-q4-k-m', '1.0.0', 'editorial-generation', 'optional-editorial',
		'qwen3-4b-q4-k-m', 'llama-cpp', 16 * GIB,
		'model', 'Qwen3-4B-Q4_K_M.gguf', 'model.gguf'),
]);

function direct(
	catalogModelId, version, task, installTier, supplyId, runtimeFamily,
	minimumMemoryBytes, role, sourceFileName, distributionFileName,
) {
	return Object.freeze({
		catalogModelId, version, task, installTier,
		supplyBinding: Object.freeze({ kind: 'direct-pin', supplyId }),
		runtimeFamily: runtimeFamily ?? 'onnxruntime-node', minimumMemoryBytes,
		artifact: Object.freeze({ role, sourceFileName, distributionFileName }),
		sourceAuthorityRoles: Object.freeze([]),
	});
}

function derived(
	catalogModelId, version, task, installTier, supplyId, outputRole,
	minimumMemoryBytes, role, sourceFileName, distributionFileName,
	sourceAuthorityRoles = [],
) {
	return Object.freeze({
		catalogModelId, version, task, installTier,
		supplyBinding: Object.freeze({ kind: 'converted-output', supplyId, outputRole }),
		runtimeFamily: 'onnxruntime-node', minimumMemoryBytes,
		artifact: Object.freeze({ role, sourceFileName, distributionFileName }),
		sourceAuthorityRoles: Object.freeze([...sourceAuthorityRoles]),
	});
}

export function validateMilestone7ModelCatalogTaskRegister(value, options) {
	const inputs = validateOptions(options);
	const record = exactRecord(value,
		['schemaVersion', 'registerId', 'productionCatalogChanged', 'tasks'],
		'Milestone 7 model catalog-task register');
	if (record.schemaVersion !== 1
		|| record.registerId !== 'milestone-7-model-catalog-tasks-v1'
		|| record.productionCatalogChanged !== false
		|| !Array.isArray(record.tasks) || record.tasks.length !== TASKS.length) {
		throw new TypeError('The Milestone 7 model catalog-task register identity is invalid.');
	}
	const tasks = record.tasks.map((task, index) => validateTask(
		task, TASKS[index], inputs,
	));
	return deepFreeze({
		schemaVersion: 1,
		registerId: record.registerId,
		productionCatalogChanged: false,
		tasks,
	});
}

function validateOptions(options) {
	if (!plainRecord(options) || !Array.isArray(options.licensingEvidence)
		|| !Array.isArray(options.offeredModelIds)
		|| options.offeredModelIds.some((id) => typeof id !== 'string' || !IDENTIFIER.test(id))
		|| new Set(options.offeredModelIds).size !== options.offeredModelIds.length) {
		throw new TypeError('Catalog-task validation needs bounded licensing and offered-model inputs.');
	}
	const supply = validateMilestone7ModelSupplyRegister(options.modelSupply);
	const fixtures = validateMilestone7ParityFixtureRegister(options.parityFixtures, supply);
	const execution = validateMilestone7ConversionExecutionRegister(
		options.conversionExecution, options.modelSupply, options.parityFixtures,
	);
	const runtimes = validateMilestone7RuntimeSupplyRegister(options.runtimeSupply);
	return {
		supply,
		fixtures,
		execution,
		runtimes,
		licensingEvidence: options.licensingEvidence,
		offeredModelIds: options.offeredModelIds,
	};
}

function validateTask(value, expected, inputs) {
	const row = exactRecord(value, [
		'catalogModelId', 'version', 'task', 'installTier', 'supplyBinding',
		'runtimeFamily', 'platforms', 'minimumMemoryBytes', 'artifacts',
		'sourceAuthorities',
		'releaseEvidence', 'catalogStatus', 'catalogBlockedBy',
		'activationStatus', 'activationBlockedBy',
		'm9ReleaseReviewStatus', 'm9ReleaseReviewBlockedBy',
	], 'Milestone 7 model catalog task');
	if (row.catalogModelId !== expected.catalogModelId || row.version !== expected.version
		|| row.task !== expected.task || row.installTier !== expected.installTier
		|| row.runtimeFamily !== expected.runtimeFamily
		|| row.minimumMemoryBytes !== expected.minimumMemoryBytes
		|| JSON.stringify(row.platforms) !== JSON.stringify(FIVE_PLATFORMS)) {
		throw new TypeError('A Milestone 7 catalog task changed its model, memory, or platform identity.');
	}
	const supplyBinding = validateSupplyBinding(row.supplyBinding, expected, inputs.supply);
	const artifact = validateArtifact(row.artifacts, expected, supplyBinding.output);
	const sourceAuthorities = validateSourceAuthorities(
		row.sourceAuthorities, expected, inputs.supply,
	);
	const releaseEvidence = validateReleaseEvidence(row.releaseEvidence);
	const catalogBlockedBy = deriveCatalogBlockers({
		expected,
		execution: inputs.execution,
		fixtures: inputs.fixtures,
		offeredModelIds: inputs.offeredModelIds,
		releaseEvidence,
	});
	if (!sameArray(row.catalogBlockedBy, catalogBlockedBy)) {
		throw new Error(`${expected.catalogModelId} catalogBlockedBy is not derived from release evidence.`);
	}
	const catalogStatus = catalogBlockedBy.length === 0 ? 'ready' : 'pending-external';
	if (row.catalogStatus !== catalogStatus) {
		throw new Error(`${expected.catalogModelId} catalogStatus must be ${catalogStatus}.`);
	}
	const activationBlockedBy = [...catalogBlockedBy];
	if (!runtimeReady(inputs.runtimes, expected.runtimeFamily)) {
		activationBlockedBy.push('runtime-target-closure');
	}
	activationBlockedBy.sort();
	if (!sameArray(row.activationBlockedBy, activationBlockedBy)) {
		throw new Error(`${expected.catalogModelId} activationBlockedBy is not derived from runtime evidence.`);
	}
	const activationStatus = activationBlockedBy.length === 0 ? 'ready' : 'pending-external';
	if (row.activationStatus !== activationStatus) {
		throw new Error(`${expected.catalogModelId} activationStatus must be ${activationStatus}.`);
	}
	const m9ReleaseReviewBlockedBy = licensingReady(
		inputs.licensingEvidence, expected.catalogModelId,
	) ? [] : ['licensing-evidence'];
	const m9ReleaseReviewStatus = m9ReleaseReviewBlockedBy.length === 0 ? 'complete' : 'pending';
	if (row.m9ReleaseReviewStatus !== m9ReleaseReviewStatus
		|| !sameArray(row.m9ReleaseReviewBlockedBy, m9ReleaseReviewBlockedBy)) {
		throw new Error(`${expected.catalogModelId} Milestone 9 release review is not derived from licensing evidence.`);
	}
	return {
		catalogModelId: row.catalogModelId,
		version: row.version,
		task: row.task,
		installTier: row.installTier,
		supplyBinding: supplyBinding.binding,
		runtimeFamily: row.runtimeFamily,
		platforms: [...FIVE_PLATFORMS],
		minimumMemoryBytes: row.minimumMemoryBytes,
		artifacts: [artifact],
		sourceAuthorities,
		releaseEvidence,
		catalogStatus,
		catalogBlockedBy,
		activationStatus,
		activationBlockedBy,
		m9ReleaseReviewStatus,
		m9ReleaseReviewBlockedBy,
	};
}

function validateSourceAuthorities(value, expected, supply) {
	if (!Array.isArray(value) || value.length !== expected.sourceAuthorityRoles.length) {
		throw new TypeError('A catalog task changed its source-authority inventory.');
	}
	if (expected.sourceAuthorityRoles.length === 0) return [];
	if (expected.supplyBinding.kind !== 'converted-output') {
		throw new TypeError('A direct catalog task cannot claim derived source authorities.');
	}
	const candidate = supply.candidates.find(({ id }) =>
		id === expected.supplyBinding.supplyId);
	return value.map((authority, index) => {
		const row = exactRecord(authority, [
			'role', 'fileName', 'url', 'revision', 'byteLength', 'integrity',
			'catalogDistribution',
		], 'catalog source authority');
		const integrity = exactRecord(row.integrity,
			['algorithm', 'value'], 'catalog source-authority integrity');
		const role = expected.sourceAuthorityRoles[index];
		const source = candidate?.source.artifacts.find((entry) => entry.role === role);
		const expectedAuthority = source && {
			role: source.role,
			fileName: source.fileName,
			url: source.url,
			revision: source.revision,
			byteLength: source.byteLength,
			integrity: { ...source.integrity },
			catalogDistribution: false,
		};
		if (!expectedAuthority
			|| JSON.stringify({ ...row, integrity: { ...integrity } })
				!== JSON.stringify(expectedAuthority)) {
			throw new TypeError('A catalog source authority changed its exact pinned identity.');
		}
		return expectedAuthority;
	});
}

function validateSupplyBinding(value, expected, supply) {
	const keys = expected.supplyBinding.kind === 'direct-pin'
		? ['kind', 'supplyId'] : ['kind', 'supplyId', 'outputRole'];
	const row = exactRecord(value, keys, 'catalog task supply binding');
	if (JSON.stringify(row) !== JSON.stringify(expected.supplyBinding)) {
		throw new TypeError('A catalog task changed its exact model-supply binding.');
	}
	if (row.kind === 'direct-pin') {
		const pin = supply.directPins.find(({ id }) => id === row.supplyId);
		if (!pin) throw new TypeError('A catalog task selected a foreign direct model pin.');
		return { binding: { ...row }, output: pin.artifact };
	}
	const candidate = supply.candidates.find(({ id }) => id === row.supplyId);
	const output = candidate?.conversion.outputs.find(({ role }) => role === row.outputRole);
	if (!candidate || !output) {
		throw new TypeError('A catalog task selected a foreign converted-model output.');
	}
	return { binding: { ...row }, output };
}

function validateArtifact(value, expected, output) {
	if (!Array.isArray(value) || value.length !== 1) {
		throw new TypeError('A catalog task must map one exact artifact.');
	}
	const row = exactRecord(value[0], [
		'role', 'sourceFileName', 'distributionFileName', 'byteLength', 'sha256',
	], 'catalog task artifact');
	if (row.role !== expected.artifact.role
		|| row.sourceFileName !== expected.artifact.sourceFileName
		|| row.distributionFileName !== expected.artifact.distributionFileName
		|| !SOURCE_FILE_NAME.test(row.sourceFileName)
		|| !FILE_NAME.test(row.distributionFileName)
		|| row.sourceFileName !== output.fileName
		|| row.byteLength !== output.byteLength || row.sha256 !== output.sha256) {
		throw new TypeError('A catalog task artifact changed its conversion or direct-pin identity.');
	}
	if ((row.byteLength === null) !== (row.sha256 === null)
		|| row.byteLength !== null && (!Number.isSafeInteger(row.byteLength)
			|| row.byteLength < 1 || !SHA256.test(row.sha256))) {
		throw new TypeError('A catalog task artifact must be wholly pending or exact.');
	}
	return { ...row };
}

function validateReleaseEvidence(value) {
	const row = exactRecord(value,
		['publicReadbackSha256', 'signedCatalogEntrySha256'], 'catalog release evidence');
	for (const field of ['publicReadbackSha256', 'signedCatalogEntrySha256']) {
		if (row[field] !== null && !SHA256.test(row[field])) {
			throw new TypeError('Catalog release evidence must be null or one exact SHA-256.');
		}
	}
	return { ...row };
}

function deriveCatalogBlockers({ expected, execution, fixtures, offeredModelIds, releaseEvidence }) {
	const blockers = [];
	if (expected.supplyBinding.kind === 'converted-output') {
		const recipe = execution.recipes.find(({ candidateId }) =>
			candidateId === expected.supplyBinding.supplyId);
		const fixture = fixtures.fixtures.find(({ candidateId }) =>
			candidateId === expected.supplyBinding.supplyId);
		const output = recipe?.outputManifest.artifacts.find(({ role }) =>
			role === expected.supplyBinding.outputRole);
		if (recipe) blockers.push(...recipe.blockedBy);
		if (!output || output.byteLength === null || output.sha256 === null) {
			blockers.push('converted-artifact-identity');
		}
		if (fixture?.evidenceStatus !== 'verified') blockers.push('source-framework-parity');
	}
	if (releaseEvidence.publicReadbackSha256 === null) {
		blockers.push('immutable-public-readback');
	}
	if (releaseEvidence.signedCatalogEntrySha256 === null
		|| !offeredModelIds.includes(expected.catalogModelId)) {
		blockers.push('external-catalog-signature');
	}
	return [...new Set(blockers)].sort();
}

function licensingReady(value, modelId) {
	const matches = value.filter((entry) => plainRecord(entry) && entry.id === modelId);
	if (matches.length !== 1) return false;
	const row = matches[0];
	return row.distributionStatus === 'permitted'
		&& Array.isArray(row.blockedBy) && row.blockedBy.length === 0
		&& plainRecord(row.requirements)
		&& Object.keys(row.requirements).length > 0
		&& Object.values(row.requirements).every((entry) =>
			plainRecord(entry) && entry.status === 'recorded');
}

function runtimeReady(value, familyId) {
	const manifest = value.manifests[familyId];
	return manifest && Array.isArray(manifest.targets)
		&& manifest.targets.length === FIVE_PLATFORMS.length
		&& manifest.targets.every(({ status }) => status === 'authenticated');
}

function exactRecord(value, keys, label) {
	if (!plainRecord(value) || !sameArray(Object.keys(value).sort(), [...keys].sort())) {
		throw new TypeError(`The ${label} must be one exact plain record.`);
	}
	return value;
}

function sameArray(left, right) {
	return Array.isArray(left) && Array.isArray(right)
		&& left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function plainRecord(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		&& Object.getPrototypeOf(value) === Object.prototype;
}

function deepFreeze(value) {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		for (const nested of Object.values(value)) deepFreeze(nested);
		Object.freeze(value);
	}
	return value;
}

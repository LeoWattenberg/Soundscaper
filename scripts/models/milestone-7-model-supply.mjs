/* SPDX-License-Identifier: AGPL-3.0-only */

/** Strict, non-activating supply and parity contracts for derived Milestone 7 models. */

import { createHash } from 'node:crypto';
import { posix } from 'node:path';

import {
	MILESTONE_7_PARITY_GENERATORS,
} from './milestone-7-parity-fixtures.mjs';

const SHA256 = /^[a-f\d]{64}$/u;
const SHA1 = /^[a-f\d]{40}$/u;
const MD5 = /^[a-f\d]{32}$/u;
const REVISION = /^[a-f\d]{40}$/u;
const SLUG = /^[a-z\d](?:[a-z\d-]{0,62}[a-z\d])?$/u;
const FILE_NAME = /^[A-Za-z\d][A-Za-z\d._=+-]{0,127}$/u;
const MAXIMUM_ARTIFACT_BYTES = 16 * 1024 ** 3;

const CANDIDATES = Object.freeze({
	'tiger-dnr-neural-core': Object.freeze({
		framework: 'pytorch',
		codeUrl: 'https://github.com/JusperLee/TIGER',
		codeRevision: '9f18d4a10a7137e1ce8052cfb62215179f1287b6',
		recipeId: 'tiger-dnr-neural-core-onnx-v1',
		parityFixtureId: 'tiger-dnr-parity-v1',
		parityGeneratorId: 'tiger-dnr-audio-v1',
		frameworks: Object.freeze(['source-pytorch', 'onnxruntime-cpu']),
		artifacts: Object.freeze([Object.freeze({
			role: 'dnr-weights', required: true, fileName: 'model.safetensors',
			url: 'https://huggingface.co/JusperLee/TIGER-DnR/resolve/b7a59560bbca10febbcd46fb01600f868e587f57/model.safetensors',
			revision: 'b7a59560bbca10febbcd46fb01600f868e587f57', byteLength: 17_130_568,
			integrity: { algorithm: 'sha256', value: 'dd1c696e72f6adea0085ef1af640882a8260519ad666422835e387a5b4abdd2a' },
		})]),
	}),
	'panns-cnn10': Object.freeze({
		framework: 'pytorch',
		codeUrl: 'https://github.com/qiuqiangkong/audioset_tagging_cnn',
		codeRevision: 'd2f4b8c18eab44737fcc0de1248ae21eb43f6aa4',
		recipeId: 'panns-cnn10-onnx-v1',
		parityFixtureId: 'panns-cnn10-parity-v1',
		parityGeneratorId: 'panns-cnn10-audio-v1',
		frameworks: Object.freeze(['source-pytorch', 'onnxruntime-cpu']),
		artifacts: Object.freeze([
			Object.freeze({
				role: 'cnn10-checkpoint', required: true, fileName: 'Cnn10_mAP=0.380.pth',
				url: 'https://zenodo.org/api/records/3987831/files/Cnn10_mAP=0.380.pth/content',
				revision: '10.5281/zenodo.3987831', byteLength: 25_237_595,
				integrity: { algorithm: 'md5', value: 'bfb1f1f9968938fa8ef4012b8471f5f6' },
			}),
			Object.freeze({
				role: 'audioset-class-map', required: true, fileName: 'class_labels_indices.csv',
				url: 'https://raw.githubusercontent.com/qiuqiangkong/audioset_tagging_cnn/d2f4b8c18eab44737fcc0de1248ae21eb43f6aa4/metadata/class_labels_indices.csv',
				revision: 'd2f4b8c18eab44737fcc0de1248ae21eb43f6aa4', byteLength: 14_675,
				integrity: { algorithm: 'sha256', value: 'cdd1049833c4b86127c2773ac0d14a2754b6a6d0d1798002ed5c66e699708429' },
			}),
		]),
	}),
	'beat-this': Object.freeze({
		framework: 'pytorch',
		codeUrl: 'https://github.com/CPJKU/beat_this',
		codeRevision: 'ad7974846029835307ba19a3d5cefbf40b243041',
		recipeId: 'beat-this-onnx-v1',
		parityFixtureId: 'beat-this-parity-v1',
		parityGeneratorId: 'beat-this-audio-v1',
		frameworks: Object.freeze(['source-pytorch', 'onnxruntime-cpu']),
		artifacts: Object.freeze([
			Object.freeze({
				role: 'small0-checkpoint', required: true, fileName: 'small0.ckpt',
				url: 'https://cloud.cp.jku.at/public.php/dav/files/7ik4RrBKTS273gp/small0.ckpt',
				revision: 'v1.1.0', byteLength: 8_451_101,
				integrity: { algorithm: 'sha1', value: '77a7ef5c21f628578f2b259ac29d2d680412efcc' },
			}),
			Object.freeze({
				role: 'final0-checkpoint', required: false, fileName: 'final0.ckpt',
				url: 'https://cloud.cp.jku.at/public.php/dav/files/7ik4RrBKTS273gp/final0.ckpt',
				revision: 'v1.1.0', byteLength: 81_058_141,
				integrity: { algorithm: 'sha1', value: 'e1506282faf66ca10e8ab50ee26bd542b7b9ff0a' },
			}),
		]),
	}),
	transnetv2: Object.freeze({
		framework: 'tensorflow',
		codeUrl: 'https://github.com/soCzech/TransNetV2',
		codeRevision: '85cef72af9a916bdfd7cc94a670c9cdfbf12d1ed',
		recipeId: 'transnetv2-onnx-v1',
		parityFixtureId: 'transnetv2-parity-v1',
		parityGeneratorId: 'transnetv2-rgb-v1',
		frameworks: Object.freeze(['source-tensorflow', 'source-pytorch', 'onnxruntime-cpu']),
		artifacts: Object.freeze([
			transNetArtifact('tensorflow-saved-model', 'saved_model.pb', 5_933_260,
				'8ac2a52c5719690d512805b6eaf5ce12097c1d8860b3d9de245dcbbc3100f554',
				'inference/transnetv2-weights/saved_model.pb'),
			transNetArtifact('tensorflow-variables-data', 'variables.data-00000-of-00001', 30_516_656,
				'b8c9dc3eb807583e6215cabee9ca61737b3eb1bceff68418b43bf71459669367',
				'inference/transnetv2-weights/variables/variables.data-00000-of-00001'),
			transNetArtifact('tensorflow-variables-index', 'variables.index', 5_526,
				'8b99e28b4ad11372d9a1ad9703298c2e370df14859da4245fdbe818e92dd403f',
				'inference/transnetv2-weights/variables/variables.index'),
		]),
	}),
});

function transNetArtifact(role, fileName, byteLength, sha256, path) {
	const revision = '85cef72af9a916bdfd7cc94a670c9cdfbf12d1ed';
	return Object.freeze({
		role, required: true, fileName,
		url: `https://github.com/soCzech/TransNetV2/raw/${revision}/${path}`,
		revision, byteLength, integrity: { algorithm: 'sha256', value: sha256 },
	});
}

const DIRECT_PINS = Object.freeze({
	'wav2vec2-base-960h-english-alignment': Object.freeze({
		repository: 'https://huggingface.co/facebook/wav2vec2-base-960h',
		revision: '6d2b9ffaac8aabc45934584ee608c5fb5ee34a4e',
		runtimeFamily: 'onnxruntime-node', fileName: 'onnx/model.onnx',
		byteLength: 377_887_594,
		sha256: 'b73fe60ddcd3fd07f91d65d50b4f10ba99039104c4fb5db5bdafbb27610bb6eb',
		minimumSystemMemoryBytes: 0,
	}),
	'qwen3-4b-q4-k-m': Object.freeze({
		repository: 'https://huggingface.co/Qwen/Qwen3-4B-GGUF',
		revision: 'bc640142c66e1fdd12af0bd68f40445458f3869b',
		runtimeFamily: 'llama-cpp', fileName: 'Qwen3-4B-Q4_K_M.gguf',
		byteLength: 2_497_280_256,
		sha256: '7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5',
		minimumSystemMemoryBytes: 16 * 1024 ** 3,
	}),
});

export function validateMilestone7ModelSupplyRegister(value) {
	const record = exactRecord(value,
		['schemaVersion', 'registerId', 'productionCatalogChanged', 'candidates', 'directPins'],
		'Milestone 7 model-supply register');
	if (record.schemaVersion !== 1
		|| record.registerId !== 'milestone-7-model-supply-candidates-v1'
		|| record.productionCatalogChanged !== false) {
		throw new TypeError('The Milestone 7 model-supply register identity is invalid.');
	}
	const candidateIds = Object.keys(CANDIDATES);
	if (!Array.isArray(record.candidates) || record.candidates.length !== candidateIds.length) {
		throw new TypeError('The Milestone 7 derived candidate inventory is not exact.');
	}
	const candidates = record.candidates.map((row, index) =>
		validateCandidate(row, candidateIds[index]));
	const directIds = Object.keys(DIRECT_PINS);
	if (!Array.isArray(record.directPins) || record.directPins.length !== directIds.length) {
		throw new TypeError('The Milestone 7 direct-pin inventory is not exact.');
	}
	const directPins = record.directPins.map((row, index) =>
		validateDirectPin(row, directIds[index]));
	return deepFreeze({
		schemaVersion: 1, registerId: record.registerId,
		productionCatalogChanged: false, candidates, directPins,
	});
}

export function validateMilestone7ParityFixtureRegister(value, supplyValue) {
	const supply = validateMilestone7ModelSupplyRegister(supplyValue);
	const record = exactRecord(value, ['schemaVersion', 'registerId', 'fixtures'],
		'Milestone 7 parity-fixture register');
	if (record.schemaVersion !== 1
		|| record.registerId !== 'milestone-7-model-parity-fixtures-v1'
		|| !Array.isArray(record.fixtures)
		|| record.fixtures.length !== supply.candidates.length) {
		throw new TypeError('The Milestone 7 parity-fixture register identity is invalid.');
	}
	const fixtures = record.fixtures.map((row, index) => {
		const candidate = supply.candidates[index];
		return validateParityFixture(row, candidate, CANDIDATES[candidate.id]);
	});
	return deepFreeze({ schemaVersion: 1, registerId: record.registerId, fixtures });
}

export function validateMilestone7ParityEvidence(value, fixture, candidate) {
	const definition = CANDIDATES[candidate?.id];
	if (!definition) throw new TypeError('Parity evidence selected a foreign model candidate.');
	const admittedCandidate = validateCandidate(candidate, candidate.id);
	if (admittedCandidate.conversion.status !== 'converted-artifact-ready') {
		throw new Error('Parity evidence cannot bless a pending converted artifact.');
	}
	const admittedFixture = validateParityFixture(fixture, admittedCandidate, definition);
	const record = exactRecord(value, [
		'schemaVersion', 'candidateId', 'fixtureId', 'recipeVersion',
		'convertedArtifacts', 'runs', 'comparisons',
	], 'Milestone 7 parity evidence');
	if (record.schemaVersion !== 1 || record.candidateId !== admittedCandidate.id
		|| record.fixtureId !== admittedFixture.id
		|| record.recipeVersion !== admittedCandidate.conversion.recipe.version) {
		throw new TypeError('The Milestone 7 parity evidence identity is invalid.');
	}
	const convertedArtifacts = evidenceFiles(
		record.convertedArtifacts, admittedCandidate.conversion.outputs, 'converted artifact');
	for (let index = 0; index < convertedArtifacts.length; index += 1) {
		const expected = admittedCandidate.conversion.outputs[index];
		const actual = convertedArtifacts[index];
		if (actual.byteLength !== expected.byteLength || actual.sha256 !== expected.sha256) {
			throw new Error('Parity evidence changed a converted artifact identity.');
		}
	}
	if (!Array.isArray(record.runs) || record.runs.length !== admittedFixture.frameworks.length) {
		throw new TypeError('Parity evidence must retain every required framework run.');
	}
	const runs = record.runs.map((row, index) => {
		const run = exactRecord(row, ['framework', 'outputs'], 'parity framework run');
		if (run.framework !== admittedFixture.frameworks[index]) {
			throw new TypeError('Parity evidence changed the framework order.');
		}
		return {
			framework: run.framework,
			outputs: evidenceFiles(run.outputs,
				admittedFixture.outputRoles.map((role) => ({ role })), 'framework output'),
		};
	});
	if (!Array.isArray(record.comparisons)
		|| record.comparisons.length !== admittedFixture.comparisons.length) {
		throw new TypeError('Parity evidence must satisfy every comparison once.');
	}
	const comparisons = record.comparisons.map((row, index) => {
		const comparison = exactRecord(row, [
			'baseline', 'candidate', 'outputRole', 'metric', 'maximum', 'observed',
		], 'parity evidence comparison');
		const contract = admittedFixture.comparisons[index];
		for (const key of ['baseline', 'candidate', 'outputRole', 'metric', 'maximum']) {
			if (comparison[key] !== contract[key]) {
				throw new TypeError('Parity evidence changed its comparison contract.');
			}
		}
		if (!Number.isFinite(comparison.observed) || comparison.observed < 0
			|| comparison.observed > comparison.maximum) {
			throw new Error('The source-framework parity threshold was not satisfied.');
		}
		return { ...contract, observed: comparison.observed };
	});
	return deepFreeze({
		schemaVersion: 1, candidateId: admittedCandidate.id, fixtureId: admittedFixture.id,
		recipeVersion: admittedCandidate.conversion.recipe.version,
		convertedArtifacts, runs, comparisons,
	});
}

export function canonicalMilestone7ConversionPlan(registerValue, candidateId) {
	const register = validateMilestone7ModelSupplyRegister(registerValue);
	const candidate = register.candidates.find(({ id }) => id === candidateId);
	if (!candidate) throw new RangeError('The Milestone 7 conversion candidate id is invalid.');
	const json = canonicalJson({
		schemaVersion: 1, registerId: register.registerId, candidateId,
		source: candidate.source, recipe: candidate.conversion.recipe,
		outputs: candidate.conversion.outputs,
	});
	return Object.freeze({ json, sha256: createHash('sha256').update(json).digest('hex') });
}

function validateCandidate(value, expectedId) {
	const definition = CANDIDATES[expectedId];
	const row = exactRecord(value, ['id', 'sourceStatus', 'source', 'conversion'],
		'Milestone 7 derived candidate');
	if (!definition || row.id !== expectedId || row.sourceStatus !== 'source-pinned') {
		throw new TypeError('The Milestone 7 derived candidate identity is invalid.');
	}
	const source = exactRecord(row.source, ['framework', 'code', 'artifacts'], 'candidate source');
	const code = exactRecord(source.code, ['url', 'revision'], 'candidate source code');
	if (source.framework !== definition.framework || code.url !== definition.codeUrl
		|| code.revision !== definition.codeRevision || !REVISION.test(code.revision)) {
		throw new TypeError('The derived candidate source pin changed.');
	}
	if (!Array.isArray(source.artifacts) || source.artifacts.length < 1
		|| source.artifacts.length > 8) {
		throw new TypeError('A source-pinned candidate needs bounded source artifacts.');
	}
	const artifacts = source.artifacts.map(validateSourceArtifact);
	if (JSON.stringify(artifacts) !== JSON.stringify(definition.artifacts)) {
		throw new TypeError('The derived candidate source-artifact closure changed.');
	}
	unique(artifacts.map(({ role }) => role), 'source artifact role');
	unique(artifacts.map(({ url }) => url), 'source artifact URL');
	const conversion = validateConversion(row.conversion, definition);
	return {
		id: expectedId, sourceStatus: 'source-pinned',
		source: { framework: source.framework, code: { ...code }, artifacts }, conversion,
	};
}

function validateSourceArtifact(value) {
	const row = exactRecord(value, [
		'role', 'required', 'fileName', 'url', 'revision', 'byteLength', 'integrity',
	], 'candidate source artifact');
	if (!SLUG.test(row.role) || typeof row.required !== 'boolean'
		|| !FILE_NAME.test(row.fileName) || !httpsUrl(row.url)
		|| typeof row.revision !== 'string' || row.revision.length < 6 || row.revision.length > 128
		|| !safeBytes(row.byteLength)) {
		throw new TypeError('A candidate source artifact identity is invalid.');
	}
	const integrity = exactRecord(row.integrity, ['algorithm', 'value'], 'source integrity');
	const pattern = integrity.algorithm === 'sha256' ? SHA256
		: integrity.algorithm === 'sha1' ? SHA1 : integrity.algorithm === 'md5' ? MD5 : null;
	if (!pattern?.test(integrity.value)) {
		throw new TypeError('A candidate source artifact has no admitted upstream checksum.');
	}
	return { ...row, integrity: { ...integrity } };
}

function validateConversion(value, definition) {
	const row = exactRecord(value, ['status', 'blockedBy', 'recipe', 'outputs'],
		'derived conversion');
	if (row.status !== 'converted-artifact-pending'
		&& row.status !== 'converted-artifact-ready') {
		throw new TypeError('The converted-artifact status is invalid.');
	}
	const recipe = validateRecipe(row.recipe, definition);
	if (!Array.isArray(row.outputs) || row.outputs.length < 1 || row.outputs.length > 8) {
		throw new TypeError('The converted-artifact inventory is invalid.');
	}
	const outputs = row.outputs.map((output) => validateConvertedOutput(output, row.status));
	unique(outputs.map(({ role }) => role), 'converted-artifact role');
	unique(outputs.map(({ fileName }) => fileName), 'converted-artifact file name');
	if (!outputs.some(({ required }) => required)) {
		throw new TypeError('A derived conversion must produce at least one required artifact.');
	}
	if (row.status === 'converted-artifact-pending') {
		boundedBlocker(row.blockedBy, 'converted-artifact blocker');
		if (recipe.toolchain.status !== 'lock-pending-external') {
			throw new Error('A pending conversion cannot claim a locked toolchain.');
		}
	} else if (row.blockedBy !== null || recipe.toolchain.status !== 'locked') {
		throw new Error('A ready converted artifact requires one digest-pinned toolchain.');
	}
	return { status: row.status, blockedBy: row.blockedBy, recipe, outputs };
}

function validateRecipe(value, definition) {
	const row = exactRecord(value, [
		'id', 'version', 'sourceFrameworks', 'toolchain', 'input', 'graph', 'onnx',
		'conversionStages', 'ownedRuntimeStages', 'parityFixtureId',
	], 'conversion recipe');
	if (row.id !== definition.recipeId || row.version !== 1
		|| row.parityFixtureId !== definition.parityFixtureId
		|| !Array.isArray(row.sourceFrameworks)
		|| JSON.stringify(row.sourceFrameworks) !== JSON.stringify(
			definition.frameworks.filter((name) => name.startsWith('source-'))
				.map((name) => name.slice('source-'.length)))) {
		throw new TypeError('The conversion recipe identity or source frameworks changed.');
	}
	const toolchain = validateToolchain(row.toolchain);
	const input = exactRecord(row.input,
		['sampleRateHz', 'channels', 'sampleEncoding'], 'recipe input adapter');
	if (!Number.isSafeInteger(input.sampleRateHz) || input.sampleRateHz < 0
		|| !['mono', 'preserve', 'rgb'].includes(input.channels)
		|| !['float32', 'uint8'].includes(input.sampleEncoding)) {
		throw new TypeError('The conversion recipe input adapter is invalid.');
	}
	const graph = exactRecord(row.graph, ['inputs', 'outputs'], 'recipe graph');
	const inputs = tensorInventory(graph.inputs, 'input');
	const outputs = tensorInventory(graph.outputs, 'output');
	const onnx = exactRecord(row.onnx, [
		'opset', 'executionProvider', 'externalData', 'customOperators',
		'deterministicAlgorithms',
	], 'recipe ONNX policy');
	if (onnx.opset !== 17 || onnx.executionProvider !== 'cpu'
		|| onnx.externalData !== false || onnx.customOperators !== false
		|| onnx.deterministicAlgorithms !== true) {
		throw new TypeError('The derived ONNX recipe must remain deterministic and CPU-only.');
	}
	const conversionStages = stringInventory(row.conversionStages, 'conversion stage', 4, 16);
	const ownedRuntimeStages = stringInventory(row.ownedRuntimeStages, 'owned runtime stage', 1, 16);
	return {
		id: row.id, version: 1, sourceFrameworks: [...row.sourceFrameworks], toolchain,
		input: { ...input }, graph: { inputs, outputs }, onnx: { ...onnx },
		conversionStages, ownedRuntimeStages, parityFixtureId: row.parityFixtureId,
	};
}

function validateToolchain(value) {
	const row = exactRecord(value, ['status', 'lockFile', 'sha256', 'blockedBy'],
		'conversion toolchain');
	if (row.status === 'lock-pending-external') {
		if (row.lockFile !== null || row.sha256 !== null) {
			throw new Error('A pending toolchain cannot carry invented lock-file evidence.');
		}
		boundedBlocker(row.blockedBy, 'toolchain blocker');
	} else if (row.status === 'locked') {
		if (!relativePath(row.lockFile) || !SHA256.test(row.sha256) || row.blockedBy !== null) {
			throw new TypeError('A locked conversion toolchain needs an exact lock digest.');
		}
	} else throw new TypeError('The conversion toolchain status is invalid.');
	return { ...row };
}

function tensorInventory(value, label) {
	if (!Array.isArray(value) || value.length < 1 || value.length > 16) {
		throw new TypeError(`The graph ${label} tensor inventory is invalid.`);
	}
	const tensors = value.map((entry) => {
		const row = exactRecord(entry, ['name', 'dataType', 'dimensions'], `graph ${label}`);
		if (!SLUG.test(row.name.replaceAll('_', '-'))
			|| !['float32', 'uint8'].includes(row.dataType)
			|| !Array.isArray(row.dimensions) || row.dimensions.length < 1
			|| row.dimensions.length > 8 || row.dimensions.some((dimension) =>
				!(Number.isSafeInteger(dimension) && dimension > 0)
				&& !(typeof dimension === 'string' && SLUG.test(dimension)))) {
			throw new TypeError(`A graph ${label} tensor descriptor is invalid.`);
		}
		return { name: row.name, dataType: row.dataType, dimensions: [...row.dimensions] };
	});
	unique(tensors.map(({ name }) => name), `graph ${label} name`);
	return tensors;
}

function validateConvertedOutput(value, status) {
	const row = exactRecord(value,
		['role', 'required', 'fileName', 'byteLength', 'sha256'], 'converted artifact');
	if (!SLUG.test(row.role) || typeof row.required !== 'boolean' || !FILE_NAME.test(row.fileName)) {
		throw new TypeError('A converted-artifact descriptor is invalid.');
	}
	if (status === 'converted-artifact-pending') {
		if (row.byteLength !== null || row.sha256 !== null) {
			throw new Error('A pending converted artifact cannot carry a digest or byte length.');
		}
	} else if (!safeBytes(row.byteLength) || !SHA256.test(row.sha256)) {
		throw new TypeError('A ready converted artifact needs an exact SHA-256 identity.');
	}
	return { ...row };
}

function validateDirectPin(value, expectedId) {
	const expected = DIRECT_PINS[expectedId];
	const row = exactRecord(value, [
		'id', 'repository', 'revision', 'runtimeFamily', 'artifact',
		'minimumSystemMemoryBytes', 'activationStatus', 'blockedBy',
	], 'direct model pin');
	const artifact = exactRecord(row.artifact,
		['fileName', 'byteLength', 'sha256'], 'direct model artifact');
	if (!expected || row.id !== expectedId || row.repository !== expected.repository
		|| row.revision !== expected.revision || row.runtimeFamily !== expected.runtimeFamily
		|| artifact.fileName !== expected.fileName || artifact.byteLength !== expected.byteLength
		|| artifact.sha256 !== expected.sha256
		|| row.minimumSystemMemoryBytes !== expected.minimumSystemMemoryBytes
		|| row.activationStatus !== 'catalog-publication-pending') {
		throw new TypeError('A direct model identity pin changed or falsely claims activation.');
	}
	boundedBlocker(row.blockedBy, 'direct model activation blocker');
	return { ...row, artifact: { ...artifact } };
}

function validateParityFixture(value, candidate, definition) {
	const row = exactRecord(value, [
		'id', 'candidateId', 'generator', 'input', 'frameworks', 'outputRoles',
		'comparisons', 'evidenceStatus', 'evidenceSha256', 'blockedBy',
	], 'parity fixture');
	if (row.id !== definition.parityFixtureId || row.candidateId !== candidate.id
		|| candidate.conversion.recipe.parityFixtureId !== row.id
		|| JSON.stringify(row.frameworks) !== JSON.stringify(definition.frameworks)) {
		throw new TypeError('The source-framework parity fixture identity changed.');
	}
	const expectedGenerator = MILESTONE_7_PARITY_GENERATORS[definition.parityGeneratorId];
	if (JSON.stringify(row.generator) !== JSON.stringify(expectedGenerator)) {
		throw new TypeError('The parity fixture generator is not the pinned deterministic recipe.');
	}
	const input = exactRecord(row.input,
		['fileName', 'mediaType', 'byteLength', 'sha256'], 'parity fixture input');
	if (!FILE_NAME.test(input.fileName) || typeof input.mediaType !== 'string'
		|| input.mediaType.length < 3 || input.mediaType.length > 128
		|| !safeBytes(input.byteLength) || !SHA256.test(input.sha256)) {
		throw new TypeError('The parity fixture input identity is invalid.');
	}
	const outputRoles = stringInventory(row.outputRoles, 'parity output role', 1, 16);
	if (!Array.isArray(row.comparisons) || row.comparisons.length < 1
		|| row.comparisons.length > 32) {
		throw new TypeError('The parity comparison inventory is invalid.');
	}
	const comparisons = row.comparisons.map((entry) => {
		const comparison = exactRecord(entry,
			['baseline', 'candidate', 'outputRole', 'metric', 'maximum'], 'parity comparison');
		if (!row.frameworks.includes(comparison.baseline)
			|| !row.frameworks.includes(comparison.candidate)
			|| comparison.baseline === comparison.candidate
			|| !outputRoles.includes(comparison.outputRole)
			|| !['maximum-absolute-error', 'symmetric-index-difference'].includes(comparison.metric)
			|| !Number.isFinite(comparison.maximum) || comparison.maximum < 0) {
			throw new TypeError('A source-framework parity comparison is invalid.');
		}
		return { ...comparison };
	});
	unique(comparisons.map((entry) => JSON.stringify(entry)), 'parity comparison');
	if (row.evidenceStatus === 'pending-external') {
		if (row.evidenceSha256 !== null) {
			throw new Error('Pending parity cannot carry an evidence digest.');
		}
		boundedBlocker(row.blockedBy, 'parity blocker');
	} else if (row.evidenceStatus === 'verified') {
		if (!SHA256.test(row.evidenceSha256) || row.blockedBy !== null) {
			throw new TypeError('Verified parity needs one exact evidence digest.');
		}
	} else throw new TypeError('The parity evidence status is invalid.');
	return {
		id: row.id, candidateId: row.candidateId, generator: clone(row.generator),
		input: { ...input }, frameworks: [...row.frameworks], outputRoles, comparisons,
		evidenceStatus: row.evidenceStatus, evidenceSha256: row.evidenceSha256,
		blockedBy: row.blockedBy,
	};
}

function evidenceFiles(value, expected, label) {
	if (!Array.isArray(value) || value.length !== expected.length) {
		throw new TypeError(`The parity ${label} inventory is not exact.`);
	}
	return value.map((entry, index) => {
		const row = exactRecord(entry, ['role', 'byteLength', 'sha256'], `parity ${label}`);
		if (row.role !== expected[index].role || !safeBytes(row.byteLength)
			|| !SHA256.test(row.sha256)) {
			throw new TypeError(`A parity ${label} identity is invalid.`);
		}
		return { ...row };
	});
}

function exactRecord(value, keys, label) {
	if (!plainRecord(value)
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
		throw new TypeError(`The ${label} must be one exact plain record.`);
	}
	return value;
}

function plainRecord(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		&& Object.getPrototypeOf(value) === Object.prototype;
}

function stringInventory(value, label, minimum, maximum) {
	if (!Array.isArray(value) || value.length < minimum || value.length > maximum
		|| value.some((entry) => typeof entry !== 'string' || !SLUG.test(entry))) {
		throw new TypeError(`The ${label} inventory is invalid.`);
	}
	unique(value, label);
	return [...value];
}

function unique(value, label) {
	if (new Set(value).size !== value.length) throw new TypeError(`The ${label} inventory repeats a value.`);
}

function boundedBlocker(value, label) {
	if (typeof value !== 'string' || value.trim().length < 24 || value.length > 1_024) {
		throw new TypeError(`The ${label} is invalid.`);
	}
}

function safeBytes(value) {
	return Number.isSafeInteger(value) && value > 0 && value <= MAXIMUM_ARTIFACT_BYTES;
}

function httpsUrl(value) {
	if (typeof value !== 'string' || value.length > 2_048) return false;
	try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

function relativePath(value) {
	return typeof value === 'string' && value.length > 0 && value.length <= 256
		&& !value.includes('\\') && posix.normalize(value) === value
		&& !posix.isAbsolute(value) && !value.startsWith('../') && !value.includes('\0');
}

function clone(value) {
	return structuredClone(value);
}

function deepFreeze(value) {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		for (const nested of Object.values(value)) deepFreeze(nested);
		Object.freeze(value);
	}
	return value;
}

function canonicalJson(value) {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	if (plainRecord(value)) {
		return `{${Object.keys(value).sort().map((key) =>
			`${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
	}
	return JSON.stringify(value);
}

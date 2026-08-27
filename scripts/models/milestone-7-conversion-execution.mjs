/* SPDX-License-Identifier: AGPL-3.0-only */

/** Fail-closed execution and retained-evidence contract for derived Milestone 7 models. */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import { basename, posix, relative, resolve, sep } from 'node:path';

import {
	validateMilestone7ModelSupplyRegister,
	validateMilestone7ParityEvidence,
	validateMilestone7ParityFixtureRegister,
} from './milestone-7-model-supply.mjs';

const SHA256 = /^[a-f\d]{64}$/u;
const MAXIMUM_FILE_BYTES = 16 * 1024 ** 3;
const MAXIMUM_EVIDENCE_BYTES = 64 * 1024 ** 3;
const TOOLCHAIN_LOCK_SHA256 = '388a9bdc8ccac14f5e16b0ea6cb2fb399c0af59b1dadd0385af7738d7ec139ef';
const ADMITTED_REGISTERS = new WeakSet();

const EXECUTION_POLICY = Object.freeze({
	protocol: 'soundscaper-model-conversion-v1',
	program: 'python3',
	module: 'soundscaper_m7_conversion',
	workingDirectory: 'workspace',
	shell: false,
	network: 'forbidden',
	gpu: 'forbidden',
	environment: Object.freeze([
		Object.freeze({ name: 'CUBLAS_WORKSPACE_CONFIG', value: ':4096:8' }),
		Object.freeze({ name: 'CUDA_VISIBLE_DEVICES', value: '' }),
		Object.freeze({ name: 'MKL_NUM_THREADS', value: '1' }),
		Object.freeze({ name: 'OMP_NUM_THREADS', value: '1' }),
		Object.freeze({ name: 'OPENBLAS_NUM_THREADS', value: '1' }),
		Object.freeze({ name: 'PYTHONHASHSEED', value: '0' }),
		Object.freeze({ name: 'TF_DETERMINISTIC_OPS', value: '1' }),
	]),
});

const SOURCE_ARCHIVE_NAMES = Object.freeze({
	'tiger-dnr-neural-core': 'tiger-9f18d4a10a7137e1ce8052cfb62215179f1287b6.tar.gz',
	'panns-cnn10': 'audioset-tagging-cnn-d2f4b8c18eab44737fcc0de1248ae21eb43f6aa4.tar.gz',
	'beat-this': 'beat-this-ad7974846029835307ba19a3d5cefbf40b243041.tar.gz',
	transnetv2: 'transnetv2-85cef72af9a916bdfd7cc94a670c9cdfbf12d1ed.tar.gz',
});

export function validateMilestone7ConversionExecutionRegister(
	value, supplyValue, fixtureValue,
) {
	const supply = validateMilestone7ModelSupplyRegister(supplyValue);
	const fixtures = validateMilestone7ParityFixtureRegister(fixtureValue, supply);
	const record = exactRecord(value,
		['schemaVersion', 'registerId', 'executionPolicy', 'recipes'],
		'Milestone 7 conversion-execution register');
	if (record.schemaVersion !== 1
		|| record.registerId !== 'milestone-7-model-conversion-execution-v1') {
		throw new TypeError('The Milestone 7 conversion-execution identity is invalid.');
	}
	if (canonicalJson(record.executionPolicy) !== canonicalJson(EXECUTION_POLICY)) {
		throw new TypeError('The deterministic conversion execution policy changed.');
	}
	if (!Array.isArray(record.recipes)
		|| record.recipes.length !== supply.candidates.length) {
		throw new TypeError('The conversion execution recipe inventory is not exact.');
	}
	const recipes = record.recipes.map((recipe, index) => validateRecipe(
		recipe, supply.candidates[index], fixtures.fixtures[index],
	));
	const admitted = deepFreeze({
		schemaVersion: 1,
		registerId: record.registerId,
		executionPolicy: clone(EXECUTION_POLICY),
		recipes,
	});
	ADMITTED_REGISTERS.add(admitted);
	return admitted;
}

function validateRecipe(value, candidate, fixture) {
	const row = exactRecord(value, [
		'candidateId', 'conversionPlanSha256', 'sourceCode', 'sourceArtifacts',
		'commands', 'outputManifest', 'parity', 'evidenceStatus', 'blockedBy',
	], 'conversion execution recipe');
	// Recompute the canonical supply plan after the strict supply validator
	// admitted the complete register; this keeps execution bound to exact inputs.
	const expectedPlanSha256 = sha256(canonicalJson({
		schemaVersion: 1,
		registerId: 'milestone-7-model-supply-candidates-v1',
		candidateId: candidate.id,
		source: candidate.source,
		recipe: candidate.conversion.recipe,
		outputs: candidate.conversion.outputs,
	}));
	if (row.candidateId !== candidate.id
		|| row.conversionPlanSha256 !== expectedPlanSha256) {
		throw new TypeError('The conversion execution plan changed its pinned supply identity.');
	}
	const sourceCode = validateSourceCode(row.sourceCode, candidate);
	const sourceArtifacts = validateSourceArtifacts(row.sourceArtifacts, candidate);
	const commands = validateCommands(row.commands, candidate.id, expectedPlanSha256);
	const outputManifest = validateOutputManifest(row.outputManifest, candidate);
	const parity = validateParity(row.parity, fixture, candidate.id);
	const blockedBy = deriveBlockers({
		candidate, sourceCode, sourceArtifacts, outputManifest, parity,
	});
	if (!sameArray(row.blockedBy, blockedBy)) {
		throw new Error(`The ${candidate.id} blockedBy inventory is not derived from its evidence.`);
	}
	const evidenceStatus = blockedBy.length === 0 ? 'verified' : 'pending-external';
	if (row.evidenceStatus !== evidenceStatus) {
		throw new Error(`${candidate.id} evidenceStatus must be ${evidenceStatus}.`);
	}
	return {
		candidateId: candidate.id,
		conversionPlanSha256: expectedPlanSha256,
		sourceCode,
		sourceArtifacts,
		commands,
		outputManifest,
		parity,
		evidenceStatus,
		blockedBy,
	};
}

function validateSourceCode(value, candidate) {
	const row = exactRecord(value, ['url', 'revision', 'archive'], 'conversion source code');
	const archive = exactRecord(row.archive,
		['fileName', 'byteLength', 'sha256'], 'conversion source-code archive');
	if (row.url !== candidate.source.code.url || row.revision !== candidate.source.code.revision
		|| archive.fileName !== SOURCE_ARCHIVE_NAMES[candidate.id]) {
		throw new TypeError('The conversion source-code pin changed.');
	}
	validatePendingOrPinnedIdentity(archive, 'source-code archive');
	return { url: row.url, revision: row.revision, archive: { ...archive } };
}

function validateSourceArtifacts(value, candidate) {
	if (!Array.isArray(value) || value.length !== candidate.source.artifacts.length) {
		throw new TypeError('The conversion source artifact inventory is not exact.');
	}
	return value.map((entry, index) => {
		const row = exactRecord(entry, [
			'role', 'fileName', 'byteLength', 'upstreamIntegrity', 'sha256Readback',
		], 'conversion source artifact');
		const expected = candidate.source.artifacts[index];
		if (row.role !== expected.role || row.fileName !== expected.fileName
			|| row.byteLength !== expected.byteLength
			|| canonicalJson(row.upstreamIntegrity) !== canonicalJson(expected.integrity)) {
			throw new TypeError('The conversion source artifact changed its pinned identity.');
		}
		if (expected.integrity.algorithm === 'sha256') {
			if (row.sha256Readback !== expected.integrity.value) {
				throw new TypeError('A SHA-256 source artifact readback changed.');
			}
		} else if (row.sha256Readback !== null && !SHA256.test(row.sha256Readback)) {
			throw new TypeError('A weak upstream source artifact needs a full SHA-256 readback.');
		}
		return { ...row, upstreamIntegrity: { ...row.upstreamIntegrity } };
	});
}

function validateCommands(value, candidateId, planSha256) {
	const expected = expectedCommands(candidateId, planSha256);
	if (!Array.isArray(value) || canonicalJson(value) !== canonicalJson(expected)) {
		throw new TypeError('The shell-free deterministic conversion command contract changed.');
	}
	return value.map((command) => {
		const expanded = {
			...command,
			program: EXECUTION_POLICY.program,
			workingDirectory: EXECUTION_POLICY.workingDirectory,
			shell: false,
			network: 'forbidden',
			gpu: 'forbidden',
			environment: clone(EXECUTION_POLICY.environment),
		};
		return { ...expanded, sha256: sha256(canonicalJson(expanded)) };
	});
}

function expectedCommands(candidateId, planSha256) {
	const shared = [
		'-I', '-B', '-m', EXECUTION_POLICY.module,
	];
	const identity = [
		'--protocol', EXECUTION_POLICY.protocol,
		'--candidate', candidateId,
		'--plan-sha256', planSha256,
	];
	return [
		{
			id: 'convert',
			argv: [...shared, 'convert', ...identity,
				'--source-manifest', 'source-input-manifest.json',
				'--output-manifest', 'converted-artifacts.json'],
		},
		{
			id: 'parity',
			argv: [...shared, 'parity', ...identity,
				'--fixture', 'parity-fixture.bin',
				'--source-runs', 'source-framework-runs',
				'--converted-manifest', 'converted-artifacts.json',
				'--evidence', 'parity-evidence.json',
				'--source-manifest', 'source-input-manifest.json',
				'--toolchain-lock', 'uv.lock',
				'--toolchain-sha256', TOOLCHAIN_LOCK_SHA256],
		},
	];
}

function validateOutputManifest(value, candidate) {
	const row = exactRecord(value,
		['schemaVersion', 'path', 'status', 'artifacts'], 'converted output manifest');
	const expectedPath = `evidence/milestone-7-model-conversion/${candidate.id}/converted-artifacts.json`;
	if (row.schemaVersion !== 1 || row.path !== expectedPath
		|| !Array.isArray(row.artifacts)
		|| row.artifacts.length !== candidate.conversion.outputs.length) {
		throw new TypeError('The converted output manifest identity is invalid.');
	}
	const artifacts = row.artifacts.map((artifact, index) => {
		const admitted = exactRecord(artifact,
			['role', 'required', 'fileName', 'byteLength', 'sha256'], 'converted output');
		const expected = candidate.conversion.outputs[index];
		if (canonicalJson(admitted) !== canonicalJson(expected)) {
			throw new TypeError('The converted output manifest changed its supply identity.');
		}
		return { ...admitted };
	});
	const status = artifacts.every(({ byteLength, sha256: digest }) =>
		safeBytes(byteLength) && SHA256.test(digest)) ? 'verified' : 'pending-external';
	if (row.status !== status) {
		throw new Error(`The converted output manifest status must be ${status}.`);
	}
	return { schemaVersion: 1, path: row.path, status, artifacts };
}

function validateParity(value, fixture, candidateId) {
	const row = exactRecord(value, [
		'fixtureId', 'inputFileName', 'inputByteLength', 'inputSha256',
		'evidencePath', 'status', 'evidenceSha256',
	], 'conversion parity binding');
	const expectedPath = `evidence/milestone-7-model-conversion/${candidateId}/parity-evidence.json`;
	if (row.fixtureId !== fixture.id || row.inputFileName !== fixture.input.fileName
		|| row.inputByteLength !== fixture.input.byteLength
		|| row.inputSha256 !== fixture.input.sha256 || row.evidencePath !== expectedPath
		|| row.status !== fixture.evidenceStatus
		|| row.evidenceSha256 !== fixture.evidenceSha256) {
		throw new TypeError('The source-framework parity binding changed.');
	}
	return { ...row };
}

function deriveBlockers({ candidate, sourceCode, sourceArtifacts, outputManifest, parity }) {
	const blockers = [];
	if (outputManifest.status !== 'verified') blockers.push('converted-output-identity');
	if (sourceArtifacts.some(({ sha256Readback }) => sha256Readback === null)) {
		blockers.push('source-artifact-sha256-readback');
	}
	if (sourceCode.archive.sha256 === null) blockers.push('source-code-archive-identity');
	if (parity.status !== 'verified') blockers.push('source-framework-parity');
	if (candidate.conversion.recipe.toolchain.status !== 'locked') blockers.push('toolchain-lock');
	return blockers.sort();
}

export function canonicalMilestone7ConversionExecutionPlan(register, candidateId) {
	if (!ADMITTED_REGISTERS.has(register)) {
		throw new TypeError('An admitted conversion-execution register is required.');
	}
	const recipe = register.recipes.find((entry) => entry.candidateId === candidateId);
	if (!recipe) throw new RangeError('The conversion execution candidate id is invalid.');
	const json = canonicalJson({
		schemaVersion: 1,
		registerId: register.registerId,
		executionPolicy: register.executionPolicy,
		recipe,
	});
	return Object.freeze({ json, sha256: sha256(json) });
}

export function validateMilestone7ConversionEvidence(value, options) {
	const register = admitRegister(options);
	const row = exactRecord(value, [
		'schemaVersion', 'candidateId', 'executionPlanSha256', 'toolchain',
		'sourceCodeArchive', 'sourceArtifacts', 'commandRuns',
		'convertedArtifacts', 'parityEvidence',
	], 'Milestone 7 conversion evidence');
	const recipe = register.recipes.find(({ candidateId }) => candidateId === row.candidateId);
	if (!recipe) throw new TypeError('Conversion evidence selected a foreign candidate.');
	if (recipe.evidenceStatus !== 'verified') {
		throw new Error(`${recipe.candidateId} cannot admit release evidence while its recipe is pending.`);
	}
	const supply = validateMilestone7ModelSupplyRegister(options.modelSupply);
	const fixtureRegister = validateMilestone7ParityFixtureRegister(options.parityFixtures, supply);
	const candidate = supply.candidates.find(({ id }) => id === recipe.candidateId);
	const fixture = fixtureRegister.fixtures.find(({ id }) => id === recipe.parity.fixtureId);
	if (row.schemaVersion !== 1
		|| row.executionPlanSha256 !== canonicalMilestone7ConversionExecutionPlan(
			register, recipe.candidateId).sha256) {
		throw new TypeError('Conversion evidence changed its execution-plan identity.');
	}
	const toolchain = exactRecord(row.toolchain, ['lockFile', 'sha256'], 'evidence toolchain');
	if (candidate.conversion.recipe.toolchain.status !== 'locked'
		|| toolchain.lockFile !== candidate.conversion.recipe.toolchain.lockFile
		|| toolchain.sha256 !== candidate.conversion.recipe.toolchain.sha256) {
		throw new Error('Conversion evidence did not use the locked toolchain.');
	}
	const sourceCodeArchive = evidenceFile(row.sourceCodeArchive, 'source-code archive');
	if (basename(sourceCodeArchive.path) !== recipe.sourceCode.archive.fileName
		|| sourceCodeArchive.byteLength !== recipe.sourceCode.archive.byteLength
		|| sourceCodeArchive.sha256 !== recipe.sourceCode.archive.sha256) {
		throw new Error('Conversion evidence changed the source-code archive identity.');
	}
	const sourceArtifacts = evidenceInventory(row.sourceArtifacts, recipe.sourceArtifacts,
		'source artifact', ({ sha256Readback }) => sha256Readback);
	const commandRuns = validateCommandRuns(row.commandRuns, recipe.commands);
	const convertedArtifacts = evidenceInventory(row.convertedArtifacts,
		recipe.outputManifest.artifacts, 'converted artifact', ({ sha256: digest }) => digest);
	const parityEvidence = validateMilestone7ParityEvidence(
		row.parityEvidence, fixture, candidate,
	);
	const parityOutputFiles = retainedParityOutputFiles(parityEvidence);
	if (sha256(canonicalJson(row.parityEvidence)) !== recipe.parity.evidenceSha256) {
		throw new Error('The retained parity evidence digest does not match its fixture binding.');
	}
	return deepFreeze({
		...row,
		toolchain: { ...toolchain },
		sourceCodeArchive,
		sourceArtifacts,
		commandRuns,
		convertedArtifacts,
		parityEvidence,
		parityOutputFiles,
		files: [
			sourceCodeArchive,
			...sourceArtifacts,
			...commandRuns.flatMap(({ stdout, stderr }) => [stdout, stderr]),
			...convertedArtifacts,
			...parityOutputFiles,
		],
	});
}

function retainedParityOutputFiles(parityEvidence) {
	return parityEvidence.runs.flatMap(({ framework, outputs }) => outputs.map((output) => {
		const extension = ['beat-points', 'downbeat-points', 'boundaries'].includes(output.role)
			? 'i64le' : 'f32le';
		return evidenceFile({
			path: `source-framework-runs/${framework}/${output.role}.${extension}`,
			byteLength: output.byteLength,
			sha256: output.sha256,
		}, 'parity framework output');
	}));
}

function admitRegister(options) {
	if (!options || typeof options !== 'object') {
		throw new TypeError('Conversion evidence validation options are required.');
	}
	if (ADMITTED_REGISTERS.has(options.executionRegister)) return options.executionRegister;
	return validateMilestone7ConversionExecutionRegister(
		options.executionRegister, options.modelSupply, options.parityFixtures,
	);
}

function validateCommandRuns(value, commands) {
	if (!Array.isArray(value) || value.length !== commands.length) {
		throw new TypeError('The retained command-run inventory is not exact.');
	}
	return value.map((entry, index) => {
		const row = exactRecord(entry,
			['id', 'commandSha256', 'exitCode', 'stdout', 'stderr'], 'conversion command run');
		if (row.id !== commands[index].id || row.commandSha256 !== commands[index].sha256
			|| row.exitCode !== 0) {
			throw new Error('A conversion command run changed or did not exit successfully.');
		}
		return { ...row, stdout: evidenceFile(row.stdout, 'command stdout', true),
			stderr: evidenceFile(row.stderr, 'command stderr', true) };
	});
}

function evidenceInventory(value, expected, label, expectedDigest) {
	if (!Array.isArray(value) || value.length !== expected.length) {
		throw new TypeError(`The retained ${label} inventory is not exact.`);
	}
	return value.map((entry, index) => {
		const row = exactRecord(entry, ['role', 'path', 'byteLength', 'sha256'], label);
		const file = evidenceFile({
			path: row.path, byteLength: row.byteLength, sha256: row.sha256,
		}, label);
		if (row.role !== expected[index].role
			|| basename(row.path) !== expected[index].fileName
			|| row.byteLength !== expected[index].byteLength
			|| row.sha256 !== expectedDigest(expected[index])) {
			throw new Error(`The retained ${label} changed its exact identity.`);
		}
		return { role: row.role, ...file };
	});
}

function evidenceFile(value, label, emptyAllowed = false) {
	const row = exactRecord(value, ['path', 'byteLength', 'sha256'], label);
	if (!relativePath(row.path)) {
		throw new TypeError(`The retained ${label} path must be relative to its evidence root.`);
	}
	if (!(Number.isSafeInteger(row.byteLength) && row.byteLength >= (emptyAllowed ? 0 : 1)
			&& row.byteLength <= MAXIMUM_FILE_BYTES)
		|| !SHA256.test(row.sha256)) {
		throw new TypeError(`The retained ${label} file identity is invalid.`);
	}
	return { ...row };
}

export async function verifyPinnedConversionEvidenceFiles(rootPath, inventory) {
	if (typeof rootPath !== 'string' || rootPath.length === 0 || !Array.isArray(inventory)
		|| inventory.length < 1 || inventory.length > 128) {
		throw new TypeError('A bounded conversion-evidence root and inventory are required.');
	}
	const admitted = inventory.map((entry) => evidenceFile(entry, 'conversion evidence', true));
	const total = admitted.reduce((sum, { byteLength }) => sum + byteLength, 0);
	if (!Number.isSafeInteger(total) || total > MAXIMUM_EVIDENCE_BYTES) {
		throw new RangeError('The conversion-evidence byte budget was exceeded.');
	}
	const root = await realpath(rootPath);
	const verified = [];
	for (const entry of admitted) {
		const path = resolve(root, ...entry.path.split('/'));
		const inside = relative(root, path);
		if (inside.startsWith(`..${sep}`) || inside === '..' || inside === '') {
			throw new TypeError('A conversion-evidence path escaped or selected its root.');
		}
		const info = await lstat(path);
		if (!info.isFile() || info.isSymbolicLink() || info.size !== entry.byteLength) {
			throw new Error(`Conversion evidence ${entry.path} has the wrong file kind or length.`);
		}
		const canonicalPath = await realpath(path);
		const canonicalInside = relative(root, canonicalPath);
		if (canonicalInside.startsWith(`..${sep}`) || canonicalInside === '..') {
			throw new TypeError('A conversion-evidence file resolved outside its root.');
		}
		const digest = await digestFile(path);
		if (digest !== entry.sha256) {
			throw new Error(`Conversion evidence ${entry.path} failed SHA-256 verification.`);
		}
		verified.push({ ...entry });
	}
	return verified;
}

async function digestFile(path) {
	const hash = createHash('sha256');
	for await (const chunk of createReadStream(path, { highWaterMark: 4 * 1024 ** 2 })) {
		hash.update(chunk);
	}
	return hash.digest('hex');
}

function validatePendingOrPinnedIdentity(value, label) {
	if (value.byteLength === null && value.sha256 === null) return;
	if (!safeBytes(value.byteLength) || !SHA256.test(value.sha256)) {
		throw new TypeError(`The ${label} must be wholly pending or carry an exact SHA-256 identity.`);
	}
}

function safeBytes(value) {
	return Number.isSafeInteger(value) && value > 0 && value <= MAXIMUM_FILE_BYTES;
}

function relativePath(value) {
	return typeof value === 'string' && value.length > 0 && value.length <= 512
		&& !value.includes('\\') && !value.includes('\0')
		&& posix.normalize(value) === value && !posix.isAbsolute(value)
		&& value !== '.' && !value.startsWith('../');
}

function exactRecord(value, keys, label) {
	if (!plainRecord(value) || !sameArray(Object.keys(value).sort(), [...keys].sort())) {
		throw new TypeError(`The ${label} must be one exact plain record.`);
	}
	return value;
}

function sameArray(left, right) {
	return Array.isArray(left) && Array.isArray(right)
		&& left.length === right.length && left.every((value, index) => value === right[index]);
}

function plainRecord(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		&& Object.getPrototypeOf(value) === Object.prototype;
}

function canonicalJson(value) {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	if (plainRecord(value)) {
		return `{${Object.keys(value).sort().map((key) =>
			`${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
	}
	return JSON.stringify(value);
}

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
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

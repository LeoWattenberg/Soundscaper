/* SPDX-License-Identifier: AGPL-3.0-only */

/** Strict, non-activating contracts for Milestone 7 native runtime supply. */

const SHA256 = /^[a-f\d]{64}$/u;
const COMMIT = /^[a-f\d]{40}$/u;
const TARGET_IDS = Object.freeze([
	'mac-arm64', 'linux-x64', 'linux-arm64', 'win-x64', 'win-arm64',
]);
const STEPS = Object.freeze([
	'fetch-pinned-source',
	'build-or-extract-cpu-target',
	'inventory-regular-files',
	'sha256-every-file',
	'pack-immutable-runtime-prefix',
	'public-readback',
	'externally-sign-manifest',
]);

const FAMILIES = Object.freeze({
	'onnxruntime-node': Object.freeze({
		version: '1.29.0',
		manifestUrl: 'https://registry.npmjs.org/onnxruntime-node/-/onnxruntime-node-1.29.0.tgz',
		revision: '1.29.0',
		recipeId: 'onnxruntime-node-upstream-closure-v1',
		source: Object.freeze({
			kind: 'npm-tarball',
			url: 'https://registry.npmjs.org/onnxruntime-node/-/onnxruntime-node-1.29.0.tgz',
			revision: '1.29.0',
			commit: '2e2543fbe9fae542f921d47a72d21d5a4ef0b710',
			integrity: 'sha512-WjiVVB72riILz8HbYvxvmjKyE/WmkYoSfKY++axo5jAR609HQg8MwiG/HhShpTcJfmmAdzxxmB+MMST3A+SiPA==',
		}),
	}),
	'whisper-cpp': Object.freeze({
		version: 'v1.9.3',
		manifestUrl: 'https://github.com/ggml-org/whisper.cpp/releases/tag/v1.9.3',
		revision: 'v1.9.3',
		recipeId: 'whisper-cpp-locked-cpu-build-v1',
		source: Object.freeze({
			kind: 'git-revision',
			url: 'https://github.com/ggml-org/whisper.cpp',
			revision: 'v1.9.3',
			commit: '371b5a7561823ab2bb32142d2751e35e7534727b',
			integrity: null,
		}),
	}),
	'llama-cpp': Object.freeze({
		version: 'b10509',
		manifestUrl: 'https://github.com/ggml-org/llama.cpp',
		revision: 'b10509',
		recipeId: 'llama-cpp-locked-cpu-build-v1',
		source: Object.freeze({
			kind: 'git-revision',
			url: 'https://github.com/ggml-org/llama.cpp',
			revision: 'b10509',
			commit: 'fe8156f789011f6ea0baf6917ea09f88b89d9554',
			integrity: null,
		}),
	}),
});

const SHERPA_ARM64 = Object.freeze({
	runtimeId: 'sherpa-onnx-node',
	version: '1.13.5',
	targetId: 'win-arm64',
	source: Object.freeze({
		url: 'https://github.com/k2-fsa/sherpa-onnx',
		revision: 'v1.13.5',
		commit: '3dc7c569f31ca2cd4a20ed6f7db780327e6714c5',
	}),
	upstreamNativeAsset: Object.freeze({
		url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.5/sherpa-onnx-v1.13.5-win-arm64-shared-MD-Release-no-tts-lib.tar.bz2',
		fileName: 'sherpa-onnx-v1.13.5-win-arm64-shared-MD-Release-no-tts-lib.tar.bz2',
		byteLength: 6_419_409,
		sha256: '42112e75ca3baf647047929f704960587cf6ed22fbd046643d66d33d7c74c123',
	}),
});

export function validateMilestone7RuntimeSupplyRegister(value) {
	const row = exactRecord(value, [
		'schemaVersion', 'registerId', 'productionPayloadsChanged', 'manifests',
		'provisionTasks', 'sherpaWindowsArm64',
	], 'runtime-supply register');
	if (row.schemaVersion !== 1
		|| row.registerId !== 'assistance-runtime-family-supply-candidates-v1'
		|| row.productionPayloadsChanged !== false) {
		throw new TypeError('The runtime-supply register identity is invalid.');
	}
	const familyIds = Object.keys(FAMILIES);
	const manifests = exactRecord(row.manifests, familyIds, 'runtime manifest inventory');
	for (const familyId of familyIds) validatePendingManifest(manifests[familyId], familyId);
	if (!Array.isArray(row.provisionTasks) || row.provisionTasks.length !== familyIds.length) {
		throw new TypeError('The runtime provision-task inventory is not exact.');
	}
	row.provisionTasks.forEach((task, index) => validateProvisionTask(task, familyIds[index]));
	validateSherpaArm64(row.sherpaWindowsArm64);
	return deepFreeze(structuredClone(row));
}

function validatePendingManifest(value, familyId) {
	const definition = FAMILIES[familyId];
	const row = exactRecord(value, [
		'schemaVersion', 'familyId', 'runtimeVersion', 'source', 'executionProvider',
		'runtimePrefix', 'targets',
	], 'pending runtime manifest');
	const source = exactRecord(row.source, ['url', 'revision'], 'runtime manifest source');
	if (row.schemaVersion !== 1 || row.familyId !== familyId
		|| row.runtimeVersion !== definition.version
		|| source.url !== definition.manifestUrl || source.revision !== definition.revision
		|| row.executionProvider !== 'cpu'
		|| row.runtimePrefix !== `assistance/${familyId}/${definition.version}`
		|| !Array.isArray(row.targets) || row.targets.length !== TARGET_IDS.length) {
		throw new TypeError('A pending runtime manifest changed its reviewed identity.');
	}
	row.targets.forEach((target, index) => {
		const entry = exactRecord(target, ['id', 'status', 'blockedBy'], 'pending runtime target');
		if (entry.id !== TARGET_IDS[index] || entry.status !== 'pending-external') {
			throw new TypeError('A runtime target falsely claims payload authority.');
		}
		blocker(entry.blockedBy, 'runtime target blocker');
	});
}

function validateProvisionTask(value, familyId) {
	const definition = FAMILIES[familyId];
	const row = exactRecord(value, [
		'schemaVersion', 'id', 'familyId', 'source', 'targetIds', 'executionProvider',
		'recipeId', 'steps', 'toolchain', 'payloadStatus', 'payloadManifestSha256',
		'blockedBy',
	], 'runtime provision task');
	const source = exactRecord(row.source,
		['kind', 'url', 'revision', 'commit', 'integrity'], 'runtime provision source');
	const toolchain = exactRecord(row.toolchain,
		['status', 'lockFile', 'sha256'], 'runtime provision toolchain');
	if (row.schemaVersion !== 1 || row.familyId !== familyId
		|| !/^provision-[a-z\d-]+-v1$/u.test(row.id)
		|| JSON.stringify(source) !== JSON.stringify(definition.source)
		|| !COMMIT.test(source.commit)
		|| JSON.stringify(row.targetIds) !== JSON.stringify(TARGET_IDS)
		|| row.executionProvider !== 'cpu' || row.recipeId !== definition.recipeId
		|| JSON.stringify(row.steps) !== JSON.stringify(STEPS)
		|| toolchain.status !== 'lock-pending-external'
		|| toolchain.lockFile !== null || toolchain.sha256 !== null
		|| row.payloadStatus !== 'pending-external' || row.payloadManifestSha256 !== null) {
		throw new TypeError('A runtime provision task changed or falsely claims a payload.');
	}
	blocker(row.blockedBy, 'runtime provision blocker');
}

function validateSherpaArm64(value) {
	const row = exactRecord(value, [
		'schemaVersion', 'runtimeId', 'version', 'targetId', 'source',
		'upstreamNativeAsset', 'payloadStatus', 'payloadManifestSha256', 'blockedBy',
	], 'Sherpa Windows ARM64 candidate');
	const source = exactRecord(row.source, ['url', 'revision', 'commit'], 'Sherpa source');
	const asset = exactRecord(row.upstreamNativeAsset,
		['url', 'fileName', 'byteLength', 'sha256'], 'Sherpa native asset');
	if (row.schemaVersion !== 1
		|| row.runtimeId !== SHERPA_ARM64.runtimeId || row.version !== SHERPA_ARM64.version
		|| row.targetId !== SHERPA_ARM64.targetId
		|| JSON.stringify(source) !== JSON.stringify(SHERPA_ARM64.source)
		|| JSON.stringify(asset) !== JSON.stringify(SHERPA_ARM64.upstreamNativeAsset)
		|| !SHA256.test(asset.sha256)
		|| row.payloadStatus !== 'pending-external' || row.payloadManifestSha256 !== null) {
		throw new TypeError('The Sherpa Windows ARM64 candidate falsely claims Node payload authority.');
	}
	blocker(row.blockedBy, 'Sherpa Windows ARM64 blocker');
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

function blocker(value, label) {
	if (typeof value !== 'string' || value.trim().length < 24 || value.length > 1_024) {
		throw new TypeError(`The ${label} is invalid.`);
	}
}

function deepFreeze(value) {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		for (const nested of Object.values(value)) deepFreeze(nested);
		Object.freeze(value);
	}
	return value;
}

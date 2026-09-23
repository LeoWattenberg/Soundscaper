/* SPDX-License-Identifier: AGPL-3.0-only */

/** Package-bound authority for AI payloads delivered after a model is selected. */

import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { extractFile } from '@electron/asar';

const MANIFEST_PATH = 'config/assistance-runtime-distribution.json';
const FAMILIES = ['sherpa-onnx-node', 'onnxruntime-node', 'whisper-cpp', 'llama-cpp', 'kokoro-g2p'];
const SHA256 = /^[a-f\d]{64}$/u;

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function digest(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

async function absent(path, label) {
	const file = await lstat(path).catch((error) => {
		if (error.code === 'ENOENT') return null;
		throw error;
	});
	assert(file === null, `${label} still contains preinstalled AI payloads.`);
}

function sameFiles(actual, expected, label) {
	const actualByPath = new Map(actual.map((file) => [file.path, file]));
	assert(actualByPath.size === actual.length && actual.length === expected.length
		&& expected.every((source) => {
			const file = actualByPath.get(source.path);
			return file?.byteLength === source.byteLength && file.sha256 === source.sha256
				&& (typeof source.executable !== 'boolean' || file.executable === source.executable);
		}),
		`${label} distribution files differ from the authenticated source manifest.`);
}

export function validateDesktopAssistanceRuntimeDistributionSummary(receipt, targetId) {
	assert(receipt?.targetId === targetId
		&& receipt.manifest?.path === MANIFEST_PATH
		&& Number.isSafeInteger(receipt.manifest.byteLength)
		&& receipt.manifest.byteLength > 0 && receipt.manifest.byteLength <= 8 * 1024 * 1024
		&& SHA256.test(receipt.manifest.sha256 ?? '')
		&& Array.isArray(receipt.bundles)
		&& JSON.stringify(receipt.bundles.map(({ familyId }) => familyId)) === JSON.stringify(FAMILIES)
		&& receipt.bundles.every((bundle) => SHA256.test(bundle.sha256 ?? '')
			&& Number.isSafeInteger(bundle.byteLength) && bundle.byteLength > 0)
		&& Array.isArray(receipt.signingFiles)
		&& (targetId === 'mac-arm64' || receipt.signingFiles.length === 0)
		&& new Set(receipt.signingFiles.map(({ path }) => path)).size === receipt.signingFiles.length
		&& receipt.signingFiles.every((file) => typeof file.path === 'string'
			&& file.path.startsWith('assistance/')
			&& !file.path.includes('\\')
			&& file.path.split('/').every((part) => part && part !== '.' && part !== '..')
			&& SHA256.test(file.original?.sha256 ?? '')
			&& Number.isSafeInteger(file.original?.byteLength) && file.original.byteLength > 0
			&& SHA256.test(file.signed?.sha256 ?? '')
			&& Number.isSafeInteger(file.signed?.byteLength) && file.signed.byteLength > 0),
		'The assistance runtime distribution build receipt is invalid.');
	return receipt;
}

/** Check the signed ASAR manifest against the original payload inventories. */
export function validateDesktopAssistanceRuntimeDistribution({
	manifestBytes, receipt, targetId, nativeManifestBytes, familyManifestBytes, kokoroManifestBytes,
}) {
	validateDesktopAssistanceRuntimeDistributionSummary(receipt, targetId);
	assert(Buffer.isBuffer(manifestBytes) && manifestBytes.byteLength > 0
		&& manifestBytes.byteLength <= 8 * 1024 * 1024
		&& receipt?.targetId === targetId
		&& receipt.manifest?.path === MANIFEST_PATH
		&& receipt.manifest.byteLength === manifestBytes.byteLength
		&& receipt.manifest.sha256 === digest(manifestBytes),
		'The packaged assistance distribution differs from its build receipt.');
	const manifest = JSON.parse(manifestBytes.toString('utf8'));
	assert(manifest.schemaVersion === 1 && manifest.targetId === targetId
		&& Array.isArray(manifest.bundles) && manifest.bundles.length === FAMILIES.length
		&& JSON.stringify(manifest.bundles.map(({ familyId }) => familyId)) === JSON.stringify(FAMILIES),
		'The packaged assistance distribution family inventory is invalid.');
	const native = JSON.parse(nativeManifestBytes.toString('utf8'));
	const family = JSON.parse(familyManifestBytes.toString('utf8'));
	const kokoro = JSON.parse(kokoroManifestBytes.toString('utf8'));
	assert(native.targets?.[targetId]?.status === 'built'
		&& kokoro.targetId === targetId && typeof kokoro.executable === 'string'
		&& kokoro.files?.some((file) => file.path === kokoro.executable)
		&& ['onnxruntime-node', 'whisper-cpp', 'llama-cpp'].every((familyId) =>
			family.manifests?.[familyId]?.targets?.find(({ id }) => id === targetId)?.status === 'authenticated'),
		'The packaged assistance source manifests have no authenticated target closure.');
	const expected = [
		{ familyId: 'sherpa-onnx-node', runtimePrefix: native.runtimePrefix,
			runtimeVersion: native.version, installPath: native.runtimePrefix,
			files: [native.commonPackage, native.targets[targetId]?.package].flatMap((descriptor) =>
				Object.entries(descriptor?.files ?? {}).map(([name, file]) => ({
					path: `node_modules/${descriptor.name}/${name}`, ...file,
				}))) },
		...['onnxruntime-node', 'whisper-cpp', 'llama-cpp'].map((familyId) => {
			const definition = family.manifests?.[familyId];
			return { familyId, runtimeVersion: definition?.runtimeVersion,
				runtimePrefix: definition?.runtimePrefix,
				installPath: `${definition?.runtimePrefix}/${targetId}`,
				files: definition?.targets?.find(({ id }) => id === targetId)?.files ?? [] };
		}),
		{ familyId: 'kokoro-g2p', runtimeVersion: kokoro.runtimeVersion,
			runtimePrefix: kokoro.runtimePrefix, installPath: `${kokoro.runtimePrefix}/${targetId}`,
			files: kokoro.files },
	];
	for (let index = 0; index < FAMILIES.length; index += 1) {
		const bundle = manifest.bundles[index];
		const source = expected[index];
		assert(bundle.familyId === source.familyId
			&& bundle.runtimeVersion === source.runtimeVersion
			&& bundle.runtimePrefix === source.runtimePrefix
			&& bundle.installPath === source.installPath
			&& Array.isArray(bundle.files) && bundle.files.length > 0
			&& SHA256.test(bundle.archive?.sha256 ?? '')
			&& Number.isSafeInteger(bundle.archive?.byteLength) && bundle.archive.byteLength > 0,
			`The packaged ${source.familyId} distribution identity is invalid.`);
		const url = `https://assets.soundscaper.org/runtime/assistance/${source.familyId}/${source.runtimeVersion}/${targetId}/${bundle.archive.sha256}.tar.gz`;
		assert(bundle.archive.url === url, `The packaged ${source.familyId} archive URL is invalid.`);
		assert(bundle.files.every((file) => typeof file.executable === 'boolean'),
			`The packaged ${source.familyId} archive modes are invalid.`);
		sameFiles(bundle.files, source.files, source.familyId);
		if (source.familyId === 'kokoro-g2p') {
			assert(bundle.files.find((file) => file.path === kokoro.executable)?.executable === true,
				'The packaged Kokoro G2P helper has no executable mode.');
		}
		assert(receipt.bundles?.[index]?.familyId === source.familyId
			&& receipt.bundles[index].sha256 === bundle.archive.sha256
			&& receipt.bundles[index].byteLength === bundle.archive.byteLength,
			`The packaged ${source.familyId} archive differs from its build receipt.`);
	}
	const distributedFiles = new Map(manifest.bundles.flatMap((bundle) => bundle.files.map((file) => [
		`${bundle.installPath}/${file.path}`, file,
	])));
	for (const signed of receipt.signingFiles) {
		const distributed = distributedFiles.get(signed.path);
		assert(distributed?.sha256 === signed.signed.sha256
			&& distributed.byteLength === signed.signed.byteLength,
			'The assistance signing receipt is not a subset of its distributed files.');
	}
	return manifest;
}

export async function verifyStagedAssistanceRuntimeDistribution({
	repositoryRoot, stageManifestPath, packagedTarget,
}) {
	const stage = JSON.parse(await readFile(stageManifestPath, 'utf8'));
	const app = resolve(repositoryRoot, '.desktop-build/app/config');
	const runtime = resolve(repositoryRoot, '.desktop-build/runtime');
	const manifest = validateDesktopAssistanceRuntimeDistribution({
		manifestBytes: await readFile(resolve(app, 'assistance-runtime-distribution.json')),
		receipt: stage.assistanceRuntimeDistribution, targetId: packagedTarget,
		nativeManifestBytes: await readFile(resolve(app, 'assistance-native-runtime-manifest.json')),
		familyManifestBytes: await readFile(resolve(app, 'assistance-runtime-family-supply-candidates.json')),
		kokoroManifestBytes: await readFile(resolve(app, 'assistance-kokoro-g2p-runtime-manifest.json')),
	});
	await absent(resolve(runtime, 'assistance'), 'Staged desktop resources');
	return manifest;
}

export async function verifyPackagedAssistanceRuntimeDistribution({
	resourcesRoot, stage, targetId,
}) {
	const asar = resolve(resourcesRoot, 'app.asar');
	const read = (name) => Buffer.from(extractFile(asar, `config/${name}`));
	const manifest = validateDesktopAssistanceRuntimeDistribution({
		manifestBytes: read('assistance-runtime-distribution.json'),
		receipt: stage.assistanceRuntimeDistribution, targetId,
		nativeManifestBytes: read('assistance-native-runtime-manifest.json'),
		familyManifestBytes: read('assistance-runtime-family-supply-candidates.json'),
		kokoroManifestBytes: read('assistance-kokoro-g2p-runtime-manifest.json'),
	});
	await absent(resolve(resourcesRoot, 'runtime/assistance'), 'Installed desktop resources');
	await absent(resolve(resourcesRoot, 'app.asar.unpacked/runtime/assistance'), 'Unpacked ASAR resources');
	return manifest;
}

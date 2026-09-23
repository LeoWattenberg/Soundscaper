/* SPDX-License-Identifier: AGPL-3.0-only */

/** Strict admission of the ASAR-sealed R2 runtime archive inventory. */

import { posix } from 'node:path';

import { ASSISTANCE_RUNTIME_FAMILY_DEFINITIONS } from './assistance-runtime-family-manifest.ts';
import type { AssistanceRuntimeArchiveFile } from './assistance-runtime-archive.ts';

export const ASSISTANCE_RUNTIME_DISTRIBUTION_FAMILIES = Object.freeze([
	'sherpa-onnx-node', 'onnxruntime-node', 'whisper-cpp', 'llama-cpp', 'kokoro-g2p',
] as const);
export type AssistanceRuntimeDistributionFamily =
	(typeof ASSISTANCE_RUNTIME_DISTRIBUTION_FAMILIES)[number];

export interface AssistanceRuntimeDistributionBundle {
	readonly familyId: AssistanceRuntimeDistributionFamily;
	readonly runtimeVersion: string;
	readonly runtimePrefix: string;
	readonly installPath: string;
	readonly archive: Readonly<{ readonly url: string; readonly byteLength: number; readonly sha256: string }>;
	readonly files: readonly AssistanceRuntimeArchiveFile[];
}

export interface AssistanceRuntimeDistribution {
	readonly schemaVersion: 1;
	readonly targetId: string;
	readonly bundles: readonly AssistanceRuntimeDistributionBundle[];
}

const VERSIONS: Readonly<Record<AssistanceRuntimeDistributionFamily, string>> = Object.freeze({
	'sherpa-onnx-node': '1.13.5',
	'onnxruntime-node': ASSISTANCE_RUNTIME_FAMILY_DEFINITIONS['onnxruntime-node'].runtimeVersion,
	'whisper-cpp': ASSISTANCE_RUNTIME_FAMILY_DEFINITIONS['whisper-cpp'].runtimeVersion,
	'llama-cpp': ASSISTANCE_RUNTIME_FAMILY_DEFINITIONS['llama-cpp'].runtimeVersion,
	'kokoro-g2p': '0.9.4',
});
const SHA256 = /^[a-f\d]{64}$/u;
const TARGETS = new Set(['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64']);
const MAXIMUM_ARCHIVE_BYTES = 4 * 1024 ** 3;
const MAXIMUM_FILE_BYTES = 4 * 1024 ** 3;

function record(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
		throw new TypeError(`The runtime distribution ${label} has invalid fields.`);
	}
	return value as Record<string, unknown>;
}

function relativePath(value: unknown): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 512
		|| value.includes('\\') || value.includes('\0') || value.startsWith('/')
		|| posix.normalize(value) !== value || value.split('/').some((part) =>
			part === '.' || part === '..' || part === '' || part.endsWith('.') || part.endsWith(' ')
			|| [...part].some((character) => character.charCodeAt(0) < 32
				|| character.charCodeAt(0) === 127 || '<>:"|?*'.includes(character))
			|| /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part))) {
		throw new TypeError('The runtime distribution has an unsafe relative path.');
	}
	return value;
}

export function runtimeDistributionTargetFor(platform: string, architecture: string): string {
	const os = platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : platform;
	const target = `${os}-${architecture}`;
	if (!TARGETS.has(target)) throw new TypeError('The runtime distribution target is unsupported.');
	return target;
}

export function validateAssistanceRuntimeDistribution(
	value: unknown,
	targetId: string,
): AssistanceRuntimeDistribution {
	const root = record(value, ['schemaVersion', 'targetId', 'bundles'], 'manifest');
	if (root.schemaVersion !== 1 || root.targetId !== targetId || !Array.isArray(root.bundles)
		|| root.bundles.length > ASSISTANCE_RUNTIME_DISTRIBUTION_FAMILIES.length) {
		throw new TypeError('The runtime distribution manifest target or version is invalid.');
	}
	const bundles = root.bundles.map((candidate): AssistanceRuntimeDistributionBundle => {
		const row = record(candidate, ['familyId', 'runtimeVersion', 'runtimePrefix',
			'installPath', 'archive', 'files'], 'bundle');
		if (typeof row.familyId !== 'string'
			|| !(ASSISTANCE_RUNTIME_DISTRIBUTION_FAMILIES as readonly string[]).includes(row.familyId)) {
			throw new TypeError('The runtime distribution family is invalid.');
		}
		const familyId = row.familyId as AssistanceRuntimeDistributionFamily;
		const version = VERSIONS[familyId];
		const prefix = familyId === 'sherpa-onnx-node'
			? `assistance/sherpa-onnx/${version}` : `assistance/${familyId}/${version}`;
		const installPath = familyId === 'sherpa-onnx-node' ? prefix : `${prefix}/${targetId}`;
		if (row.runtimeVersion !== version || row.runtimePrefix !== prefix
			|| row.installPath !== installPath) {
			throw new TypeError('The runtime distribution bundle version or install path is invalid.');
		}
		const archive = record(row.archive, ['url', 'byteLength', 'sha256'], 'archive');
		if (typeof archive.sha256 !== 'string' || !SHA256.test(archive.sha256)
			|| !Number.isSafeInteger(archive.byteLength) || Number(archive.byteLength) < 1
			|| Number(archive.byteLength) > MAXIMUM_ARCHIVE_BYTES
			|| archive.url !== `https://assets.soundscaper.org/runtime/assistance/${familyId}/${version}/${targetId}/${archive.sha256}.tar.gz`) {
			throw new TypeError('The runtime distribution archive URL or digest is invalid.');
		}
		if (!Array.isArray(row.files) || row.files.length < 1 || row.files.length > 16_384) {
			throw new TypeError('The runtime distribution file inventory is invalid.');
		}
		let lastPath = '';
		let totalBytes = 0;
		const files = row.files.map((item): AssistanceRuntimeArchiveFile => {
			const file = record(item, ['path', 'byteLength', 'sha256', 'executable'], 'file');
			const path = relativePath(file.path);
			if (lastPath !== '' && path <= lastPath
				|| !Number.isSafeInteger(file.byteLength) || Number(file.byteLength) < 0
				|| Number(file.byteLength) > MAXIMUM_FILE_BYTES
				|| typeof file.sha256 !== 'string' || !SHA256.test(file.sha256)
				|| typeof file.executable !== 'boolean') {
				throw new TypeError('The runtime distribution file pin is invalid or unsorted.');
			}
			lastPath = path;
			totalBytes += Number(file.byteLength);
			if (totalBytes > 4 * 1024 ** 3) {
				throw new TypeError('The runtime distribution closure exceeds its byte bound.');
			}
			return Object.freeze({ path, byteLength: Number(file.byteLength), sha256: file.sha256,
				executable: file.executable });
		});
		if (files.some((file, index) => files.slice(index + 1).some((next) => next.path.startsWith(`${file.path}/`)))) {
			throw new TypeError('The runtime distribution file paths overlap.');
		}
		return Object.freeze({ familyId, runtimeVersion: version, runtimePrefix: prefix, installPath,
			archive: Object.freeze({ url: archive.url as string,
				byteLength: archive.byteLength as number, sha256: archive.sha256 }),
			files: Object.freeze(files) });
	});
	if (new Set(bundles.map(({ familyId }) => familyId)).size !== bundles.length) {
		throw new TypeError('The runtime distribution repeats a family.');
	}
	return Object.freeze({ schemaVersion: 1, targetId, bundles: Object.freeze(bundles) });
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import manifest from '../../config/electron-alternate-ffmpeg-manifest.json' with { type: 'json' };
import { nativeAddonPayloadTargetForPackagingContext } from './native-addon-payload-manifest.mjs';

const TARGETS = Object.freeze([
	'linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64',
]);
const TARGET_SET = new Set(TARGETS);
const SHA256 = /^[0-9a-f]{64}$/u;
const ARTIFACT = /^ffmpeg-v[0-9]+\.[0-9]+\.[0-9]+-(?:linux-(?:x64|arm64)|darwin-arm64|win32-(?:x64|arm64))\.zip$/u;
const LIBRARIES = Object.freeze({
	'linux-x64': 'libffmpeg.so',
	'linux-arm64': 'libffmpeg.so',
	'mac-arm64': 'libffmpeg.dylib',
	'win-x64': 'ffmpeg.dll',
	'win-arm64': 'ffmpeg.dll',
});

export const ELECTRON_ALTERNATE_FFMPEG_MANIFEST = normalizeElectronAlternateFfmpegManifest(manifest);

export function normalizeElectronAlternateFfmpegManifest(value) {
	if (!plainRecord(value) || !exactKeys(value, ['schemaVersion', 'electronVersion', 'profile', 'targets'])
		|| value.schemaVersion !== 1 || typeof value.electronVersion !== 'string'
		|| !/^[0-9]+\.[0-9]+\.[0-9]+$/u.test(value.electronVersion)
		|| value.profile !== 'electron-alternate-without-proprietary-codecs'
		|| !Array.isArray(value.targets) || value.targets.length !== TARGETS.length) {
		throw new TypeError('The Electron alternate FFmpeg manifest is invalid.');
	}
	const targets = value.targets.map((candidate) => normalizeTarget(candidate, value.electronVersion));
	if (targets.some((candidate, index) => candidate.target !== TARGETS[index])) {
		throw new TypeError('The Electron alternate FFmpeg manifest must contain the exact supported target order.');
	}
	return Object.freeze({
		schemaVersion: 1,
		electronVersion: value.electronVersion,
		profile: value.profile,
		targets: Object.freeze(targets),
	});
}

/** Verify the exact alternate Electron media library during package finalization. */
export async function verifyPackagedElectronAlternateFfmpeg(context, dependencies = {}) {
	const admittedManifest = normalizeElectronAlternateFfmpegManifest(
		dependencies.manifest ?? ELECTRON_ALTERNATE_FFMPEG_MANIFEST,
	);
	const target = nativeAddonPayloadTargetForPackagingContext(context);
	const row = admittedManifest.targets.find((candidate) => candidate.target === target);
	if (!row) throw new Error(`Electron alternate FFmpeg has no admitted ${target} payload.`);
	const libraryPath = packagedLibraryPath(context, row.libraryName, target);
	const metadata = await (dependencies.lstat ?? lstat)(libraryPath).catch((error) => {
		throw new Error(`Packaged Electron alternate FFmpeg ${target} is unavailable.`, { cause: error });
	});
	if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size !== row.byteLength) {
		throw new Error(`Packaged Electron alternate FFmpeg ${target} has an invalid file type or byte length.`);
	}
	const bytes = await (dependencies.readFile ?? readFile)(libraryPath);
	if (!(bytes instanceof Uint8Array) || bytes.byteLength !== row.byteLength
		|| createHash('sha256').update(bytes).digest('hex') !== row.sha256) {
		throw new Error(`Packaged Electron alternate FFmpeg ${target} failed its exact digest check.`);
	}
	return Object.freeze({
		status: 'verified-electron-alternate-ffmpeg',
		target,
		sha256: row.sha256,
	});
}

function normalizeTarget(value, electronVersion) {
	if (!plainRecord(value) || !exactKeys(value, [
		'target', 'artifact', 'archiveSha256', 'libraryName', 'byteLength', 'sha256',
	]) || typeof value.target !== 'string' || !TARGET_SET.has(value.target)
		|| value.target === 'mac-x64' || typeof value.artifact !== 'string'
		|| !ARTIFACT.test(value.artifact) || !value.artifact.startsWith(`ffmpeg-v${electronVersion}-`)
		|| value.libraryName !== LIBRARIES[value.target]
		|| !Number.isSafeInteger(value.byteLength) || value.byteLength < 1 || value.byteLength > 16 * 1024 * 1024
		|| typeof value.archiveSha256 !== 'string' || !SHA256.test(value.archiveSha256)
		|| typeof value.sha256 !== 'string' || !SHA256.test(value.sha256)) {
		throw new TypeError('An Electron alternate FFmpeg target row is invalid.');
	}
	return Object.freeze({
		target: value.target,
		artifact: value.artifact,
		archiveSha256: value.archiveSha256,
		libraryName: value.libraryName,
		byteLength: value.byteLength,
		sha256: value.sha256,
	});
}

function packagedLibraryPath(context, libraryName, target) {
	if (!context || typeof context !== 'object' || typeof context.appOutDir !== 'string'
		|| context.appOutDir.trim() === '' || !context.packager
		|| typeof context.packager.appInfo?.productFilename !== 'string') {
		throw new TypeError('The Electron package context is invalid.');
	}
	const root = resolve(context.appOutDir);
	if (target !== 'mac-arm64') return join(root, libraryName);
	return join(
		root, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Frameworks',
		'Electron Framework.framework', 'Versions', 'A', 'Libraries', libraryName,
	);
}

function exactKeys(value, expected) {
	const keys = Reflect.ownKeys(value);
	return keys.length === expected.length
		&& expected.every((key) => Object.hasOwn(value, key))
		&& keys.every((key) => typeof key === 'string' && expected.includes(key));
}

function plainRecord(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import { collectExtractedSourceTree } from './source-authentication.mjs';

const ALGORITHM = 'framescaper-portable-source-tree-sha256-v1';
const FIELDS = Object.freeze([
	'id', 'version', 'revision', 'tag', 'url', 'byteLength', 'sha256',
	'extractedTree', 'ffmpegConfigureFlag',
]);
const TREE_FIELDS = Object.freeze(['algorithm', 'fileCount', 'sha256']);

export const FRAMESCAPER_MEDIA_HOST_EXTERNAL_SOURCE_IDS = Object.freeze([
	'x264', 'x265', 'libvpx', 'libopus',
]);

const EXPECTED = Object.freeze({
	x264: Object.freeze({
		version: 'stable-b35605ac', revision: 'b35605ace3ddf7c1a5d67a2eb553f034aef41d55',
		tag: null, byteLength: 1_040_327,
		sha256: 'cd71a7515b0e9a012e1ac9b1f8415bebcaf6fc97d4db32286642ac4c0fbe24f9',
		fileCount: 270, treeSha256: '076152c7f1d5923ec47da253de0d13e9881c3818dc53b4c1dfb0ea8505e0c4ad',
		configureFlag: '--enable-libx264',
	}),
	x265: Object.freeze({
		version: '4.2', revision: 'e444744c03978c1fb4e037168967020cf2648427',
		tag: '4.2', byteLength: 1_833_442,
		sha256: '40b1ea0453e0309f0eba934e0ddf533f8f6295966679e8894e8f1c1c8d5e1210',
		fileCount: 409, treeSha256: 'fd3b109e8d617713fba18dfcbbef8c9a5135ee4dfc7321dba2b71f3b444809bb',
		configureFlag: '--enable-libx265',
	}),
	libvpx: Object.freeze({
		version: '1.16.0', revision: '1024874c5919305883187e2953de8fcb4c3d7fa6',
		tag: 'v1.16.0', byteLength: 5_635_379,
		sha256: '7a479a3c66b9f5d5542a4c6a1b7d3768a983b1e5c14c60a9396edc9b649e015c',
		fileCount: 1_250, treeSha256: '459375253b653cc26d057e102b134fb4ac3664a8eab5a01de87176d950a92594',
		configureFlag: '--enable-libvpx',
	}),
	libopus: Object.freeze({
		version: '1.6', revision: 'a8b13e40d751c7b40833b94fc9437c5c3439da89',
		tag: 'v1.6', byteLength: 36_317_446,
		sha256: 'b7637334527201fdfd6dd6a02e67aceffb0e5e60155bbd89175647a80301c92c',
		fileCount: 482, treeSha256: '9c0e596e8baa8281d7728c8d27d3ae98624de30254bf9767f07b4d76a1a9869a',
		configureFlag: '--enable-libopus',
	}),
});

export function validateFramescaperMediaHostExternalSourceManifest(value) {
	const manifest = exactRecord(value, [
		'schemaVersion', 'sourceDateEpoch', 'activation', 'libraries',
	], 'external-source manifest');
	if (manifest.schemaVersion !== 1 || manifest.sourceDateEpoch !== 1_786_492_800
		|| manifest.activation !== 'blocked-policy' || !Array.isArray(manifest.libraries)
		|| manifest.libraries.length !== FRAMESCAPER_MEDIA_HOST_EXTERNAL_SOURCE_IDS.length) {
		throw new TypeError('The media-host external-source manifest identity is unsupported.');
	}
	const seen = new Set();
	for (const value_ of manifest.libraries) {
		const row = exactRecord(value_, FIELDS, 'external-source row');
		const expected = EXPECTED[row.id];
		const tree = exactRecord(row.extractedTree, TREE_FIELDS, 'external-source tree');
		if (!expected || seen.has(row.id) || row.version !== expected.version
			|| row.revision !== expected.revision || row.tag !== expected.tag
			|| typeof row.url !== 'string' || !row.url.startsWith('https://')
			|| row.byteLength !== expected.byteLength || row.sha256 !== expected.sha256
			|| tree.algorithm !== ALGORITHM || tree.fileCount !== expected.fileCount
			|| tree.sha256 !== expected.treeSha256
			|| row.ffmpegConfigureFlag !== expected.configureFlag) {
			throw new TypeError(`The media-host external-source row ${String(row.id)} drifted.`);
		}
		seen.add(row.id);
	}
	if (FRAMESCAPER_MEDIA_HOST_EXTERNAL_SOURCE_IDS.some((id) => !seen.has(id))) {
		throw new TypeError('The media-host external-source manifest is incomplete.');
	}
	return Object.freeze(structuredClone(manifest));
}

/** Authenticate a provisioned extracted source tree before any build consumes it. */
export function authenticateFramescaperMediaHostExternalSourceRoot(
	manifestValue, libraryId, sourceRoot,
) {
	const manifest = validateFramescaperMediaHostExternalSourceManifest(manifestValue);
	if (!FRAMESCAPER_MEDIA_HOST_EXTERNAL_SOURCE_IDS.includes(libraryId)) {
		throw new RangeError(`Unknown media-host external source ${String(libraryId)}.`);
	}
	const row = manifest.libraries.find(({ id }) => id === libraryId);
	const actual = collectExtractedSourceTree(sourceRoot);
	if (actual.algorithm !== row.extractedTree.algorithm
		|| actual.fileCount !== row.extractedTree.fileCount
		|| actual.sha256 !== row.extractedTree.sha256) {
		throw new Error(`The provisioned ${libraryId} source tree drifted from its pin.`);
	}
	return Object.freeze({
		id: libraryId, version: row.version, revision: row.revision,
		archiveSha256: row.sha256, extractedTreeSha256: actual.sha256,
	});
}

function exactRecord(value, fields, name) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`Media-host ${name} must be a plain record.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`Media-host ${name} has missing or unsupported fields.`);
	}
	return value;
}

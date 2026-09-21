/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve, sep } from 'node:path';

function codecFile(codec, path, byteLength, sha256) {
	return Object.freeze({
		source: `src/common/editor/${codec}/${path}`,
		destination: `codecs/${codec}/${path}`,
		byteLength,
		sha256,
	});
}

function toolchainFile(path, byteLength, sha256) {
	return Object.freeze({
		source: `src/common/editor/staffpad/licenses/${path}`,
		destination: `codecs/wasm-toolchain/licenses/${path}`,
		byteLength,
		sha256,
	});
}

/** Exact notices, license texts, and source manifests shipped beside bundled desktop codecs. */
export const DESKTOP_BUNDLED_CODEC_NOTICE_FILES = Object.freeze([
	codecFile('flac', 'NOTICE.md', 935,
		'7ce903d4511e2b277773303415ba44c98144b8429f3219d5d1ae632ad4aeeef4'),
	codecFile('flac', 'licenses/FLAC.txt', 1_509,
		'7866ee98760fc1f0156b4fe6bf530257e02be487ab3fd94e2b63799dd32d6b2c'),
	codecFile('flac', 'source-manifest.json', 3127,
		'7f32393d8fed7ae3f87227e5ff68d87cb1197effdf875f185925497bd9cd5b77'),
	codecFile('lame', 'NOTICE.md', 1_155,
		'4c5aa0f920cd13893d0f595acd4dc3efffe02cfa66f7487f8643733d4e6de3b0'),
	codecFile('lame', 'licenses/LAME.txt', 667,
		'd1210773dd3fb28ffcaba2acb6b6c255a7aa8401c27efff4f3a049029f19a201'),
	codecFile('lame', 'licenses/LGPL-2.0.txt', 25_279,
		'8e37572d65d965c218080fe4333779bd8743e0a280a2d447bce16a850f82917e'),
	codecFile('lame', 'source-manifest.json', 2770,
		'db4b70e0becdc76f1c4ea8fc13fab5751093c70f4249d130829620bd24a1b647'),
	codecFile('mpg123', 'NOTICE.md', 1_222,
		'b65721b67e2fc743fe71d3947122c5c05f5651183037dd6d12938a2e63aaf5ca'),
	codecFile('mpg123', 'licenses/MPG123.txt', 40_718,
		'c22482728a634a8dfdb4ff72a96d4c1ed64cd8f3e79335c401751ac591609366'),
	codecFile('mpg123', 'source-manifest.json', 3454,
		'f0b9b1046717c07f9cf1a6382a1c9b5fc25f1c3c10c0a50b94cea8fea2081b10'),
	codecFile('opus', 'NOTICE.md', 1_455,
		'ad89c0bbc9dc5b111382f396f43d4ef94724399715dcc83bec43c286d544012a'),
	codecFile('opus', 'licenses/OGG.txt', 1_466,
		'd2ab5758336489da61c12cc5bb757da5339c4ae9001f9bb0562b4370249af814'),
	codecFile('opus', 'licenses/OPUS.txt', 1_945,
		'01e1167d54a096d123cf6dfbbeb19587278845c6481d2d66d545669846079551'),
	codecFile('opus', 'source-manifest.json', 3958,
		'd5df110c7aee7c692e5ea7d6f2892a13ad661ad7f15ac994b4a0eb3627ef0039'),
	codecFile('twolame', 'NOTICE.md', 1_297,
		'75b8e9d4717fec80d9cceeced0400654915a1e307aa6099e5841eedbed1ae984'),
	codecFile('twolame', 'SOURCE.md', 1_107,
		'a653fb17b767a33c6140fd9088d992d9e380b1c785279fe27336204b3a813792'),
	codecFile('twolame', 'licenses/TWOLAME.txt', 756,
		'37f5f9a8837237583446fd2bf0a2896639db8a9ea527a6439e9b83e7a5492703'),
	codecFile('twolame', 'source-manifest.json', 2753,
		'244cd6f1fa8bc13947c18a938c293048c9d9be80d7a100bb9a300d49fc90b16b'),
	codecFile('vorbis', 'NOTICE.md', 1_701,
		'5e81e5b95eefc5624cddf32306904541c61d46a75694ab202d3c5d1f0ae3ee21'),
	codecFile('vorbis', 'licenses/OGG.txt', 1_466,
		'd2ab5758336489da61c12cc5bb757da5339c4ae9001f9bb0562b4370249af814'),
	codecFile('vorbis', 'licenses/VORBIS.txt', 1_470,
		'ec1815db59fcd302846df949d7424876cb2e2dc5ed1606c5fb0b36787b1cf43a'),
	codecFile('vorbis', 'source-manifest.json', 3946,
		'11fb0bede1d9b73275b3e11e0ea313971dd2d8465186abc3af5d6693456ddda7'),
	toolchainFile('COMPILER_RT.txt', 16_708,
		'1a8f1058753f1ba890de984e48f0242a3a5c29a6a8f2ed9fd813f36985387e8d'),
	toolchainFile('EMSCRIPTEN.txt', 5_093,
		'620a78084fc7ca97c0b5dea9abf891f3ffcadfdbf305276f099c9c4e12fc1d86'),
	toolchainFile('MUSL.txt', 6_204,
		'f9bc4423732350eb0b3f7ed7e91d530298476f8fec0c6c427a1c04ade22655af'),
	codecFile('wavpack', 'NOTICE.md', 1_054,
		'1bf8aa393a23b217c55d2afd7d20dcdd1fdf1f20c168eb176619dfb0afdefb3d'),
	codecFile('wavpack', 'licenses/WAVPACK.txt', 1_561,
		'1703dd391c9b422910287add8483a27d9bead0b0b5ccd6d5017e995a7192b3e2'),
	codecFile('wavpack', 'source-manifest.json', 6053,
		'e84eee22e06ba5562510e37b36e4b83b11b2306eb3841d3687a8fce2998ed381'),
]);

/** Stage immutable codec notices into the generated desktop license tree. */
export async function stageDesktopBundledCodecNotices({ repositoryRoot, outputRoot }) {
	const repository = absoluteRoot(repositoryRoot, 'Desktop codec notice repository root');
	const output = absoluteRoot(outputRoot, 'Desktop codec notice output root');
	await mkdir(output, { recursive: true });
	const [realRepository, realOutput] = await Promise.all([realpath(repository), realpath(output)]);
	const files = [];
	for (const descriptor of DESKTOP_BUNDLED_CODEC_NOTICE_FILES) {
		const source = containedPath(repository, descriptor.source);
		const sourceMetadata = await lstat(source);
		if (!sourceMetadata.isFile() || sourceMetadata.isSymbolicLink()) {
			throw new Error(`Desktop codec notice source is not a regular file: ${descriptor.source}`);
		}
		assertContained(realRepository, await realpath(source), 'Desktop codec notice source');
		const bytes = await readFile(source);
		if (bytes.byteLength !== descriptor.byteLength || sha256(bytes) !== descriptor.sha256) {
			throw new Error(`Desktop codec notice does not match reviewed evidence: ${descriptor.source}`);
		}
		const destination = containedPath(output, descriptor.destination);
		await mkdir(dirname(destination), { recursive: true });
		assertContained(realOutput, await realpath(dirname(destination)), 'Desktop codec notice destination');
		await writeFile(destination, bytes, { flag: 'wx', mode: 0o644 });
		files.push(Object.freeze({
			path: descriptor.destination,
			byteLength: descriptor.byteLength,
			sha256: descriptor.sha256,
		}));
	}
	return Object.freeze({ schemaVersion: 1, files: Object.freeze(files) });
}

function absoluteRoot(value, label) {
	if (typeof value !== 'string' || value.length === 0 || value.includes('\0') || !isAbsolute(value)) {
		throw new TypeError(`${label} is invalid.`);
	}
	return resolve(value);
}

function containedPath(root, relativePath) {
	const path = resolve(root, relativePath);
	assertContained(root, path, 'Desktop codec notice path');
	return path;
}

function assertContained(root, path, label) {
	if (path !== root && !path.startsWith(`${root}${sep}`)) {
		throw new Error(`${label} leaves its declared root.`);
	}
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

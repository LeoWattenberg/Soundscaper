#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import {
	copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { readBundledCodecSourceInput } from './lib/bundled-codec-source-input.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const opusDirectory = join(root, 'src/common/editor/opus');
const manifest = JSON.parse(readFileSync(join(opusDirectory, 'source-manifest.json'), 'utf8'));
const outputArgumentIndex = process.argv.indexOf('--output');
const outputPath = outputArgumentIndex >= 0
	? resolve(root, process.argv[outputArgumentIndex + 1])
	: join(opusDirectory, manifest.wasm.path);
const emcc = process.env.EMCC || 'emcc';
const emconfigure = process.env.EMCONFIGURE || 'emconfigure';
const emmake = process.env.EMMAKE || 'emmake';
const emar = process.env.EMAR || 'emar';
const environment = {
	...process.env,
	SOURCE_DATE_EPOCH: manifest.toolchain.sourceDateEpoch,
	TZ: 'UTC',
	LC_ALL: 'C',
};

verifyManifest();
verifyLocalFiles();
verifyCompiler();

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'soundscaper-opus-wasm-'));
try {
	const opusArchive = await fetchArchive(
		manifest.opus, temporaryDirectory, 'opus.tar.gz', 'opus-1.6.1.tar.gz',
	);
	const oggArchive = await fetchArchive(
		manifest.ogg, temporaryDirectory, 'ogg.tar.xz', 'libogg-1.3.6.tar.xz',
	);
	run('tar', ['-xzf', opusArchive, '-C', temporaryDirectory]);
	run('tar', ['-xJf', oggArchive, '-C', temporaryDirectory]);
	const opusSource = join(temporaryDirectory, 'opus-1.6.1');
	const oggSource = join(temporaryDirectory, 'libogg-1.3.6');
	const opusBuild = join(temporaryDirectory, 'build-opus');
	const oggBuild = join(temporaryDirectory, 'build-ogg');
	mkdirSync(opusBuild);
	mkdirSync(oggBuild);
	const commonFlags = [
		'-O3', '-flto', '-mno-simd128', '-fno-fast-math', '-fno-finite-math-only',
		'-fvisibility=hidden', '-DNDEBUG=1',
	];
	configureAndBuild({
		buildDirectory: oggBuild,
		configure: join(oggSource, 'configure'),
		arguments_: manifest.configureArguments.ogg,
		flags: [...commonFlags, ...prefixMapFlags(oggSource, 'libogg-1.3.6')],
	});
	configureAndBuild({
		buildDirectory: opusBuild,
		configure: join(opusSource, 'configure'),
		arguments_: manifest.configureArguments.opus,
		flags: [...commonFlags, ...prefixMapFlags(opusSource, 'opus-1.6.1')],
	});
	const opusLibrary = join(opusBuild, '.libs/libopus.a');
	const oggLibrary = join(oggBuild, 'src/.libs/libogg.a');
	const opusMembers = archiveEvidence(opusLibrary);
	const oggMembers = archiveEvidence(oggLibrary);
	verifyArchiveEvidence(opusMembers, oggMembers);
	const exportedFunctions = manifest.wasm.requiredExports
		.filter((name) => name.startsWith('scop_'))
		.map((name) => `_${name}`);
	const temporaryOutput = join(temporaryDirectory, 'opus.wasm');
	run(emcc, [
		join(opusDirectory, 'native/soundscaper_opus.c'), opusLibrary, oggLibrary,
		`-I${join(opusSource, 'include')}`, `-I${join(oggSource, 'include')}`,
		`-I${join(oggBuild, 'include')}`, '-std=c11', ...commonFlags,
		...prefixMapFlags(opusSource, 'opus-1.6.1'),
		...prefixMapFlags(oggSource, 'libogg-1.3.6'),
		`-ffile-prefix-map=${root}=.`, `-fdebug-prefix-map=${root}=.`,
		'--no-entry', '-sSTANDALONE_WASM=1', '-sFILESYSTEM=0', '-sALLOW_MEMORY_GROWTH=1',
		`-sINITIAL_MEMORY=${String(manifest.wasm.initialMemoryBytes)}`,
		`-sMAXIMUM_MEMORY=${String(manifest.wasm.maximumMemoryBytes)}`,
		`-sSTACK_SIZE=${String(manifest.wasm.stackBytes)}`, '-sMALLOC=emmalloc',
		'-sASSERTIONS=0', '-sSUPPORT_LONGJMP=0', '-sDISABLE_EXCEPTION_CATCHING=1',
		'-sERROR_ON_UNDEFINED_SYMBOLS=1',
		`-sEXPORTED_FUNCTIONS=${JSON.stringify(exportedFunctions)}`,
		'-Wl,--strip-all', '-o', temporaryOutput,
	]);
	const bytes = readFileSync(temporaryOutput);
	const hash = sha256(bytes);
	if (bytes.byteLength > manifest.wasm.maximumBytes) {
		throw new Error(`Ogg Opus WASM is ${String(bytes.byteLength)} bytes; limit is ${String(manifest.wasm.maximumBytes)}.`);
	}
	if (manifest.wasm.sha256 && hash !== manifest.wasm.sha256) {
		throw new Error(`Ogg Opus WASM hash mismatch: expected ${manifest.wasm.sha256}, got ${hash}.`);
	}
	mkdirSync(dirname(outputPath), { recursive: true });
	copyFileSync(temporaryOutput, outputPath);
	process.stdout.write(
		`Built ${relative(root, outputPath)} (${String(statSync(outputPath).size)} bytes)\nSHA-256 ${hash}\n`
		+ `libopus archive ${String(opusMembers.count)} members, SHA-256 ${opusMembers.sha256}\n`
		+ `libogg archive ${String(oggMembers.count)} members, SHA-256 ${oggMembers.sha256}\n`,
	);
	if (!manifest.wasm.sha256 || !manifest.compiledArchiveEvidence.opusMembersSha256) {
		process.stdout.write('Bootstrap build: pin the artifact and archive-member evidence, then rebuild.\n');
	}
} finally {
	rmSync(temporaryDirectory, { recursive: true, force: true });
}

async function fetchArchive(admission, directory, filename, bundledFileName) {
	const bytes = await readBundledCodecSourceInput({
		fileName: bundledFileName,
		maximumBytes: 16 * 1024 * 1024,
		readRemote: async () => {
			const response = await fetch(admission.archiveUrl, { redirect: 'follow' });
			if (!response.ok || response.url !== admission.archiveRedirectUrl) {
				throw new Error(`Could not fetch exact ${admission.tag} source archive (${String(response.status)}).`);
			}
			return new Uint8Array(await response.arrayBuffer());
		},
	});
	if (bytes.byteLength < 256 * 1024 || bytes.byteLength > 16 * 1024 * 1024
		|| sha256(bytes) !== admission.archiveSha256) {
		throw new Error(`The ${admission.tag} source archive does not match its exact release digest.`);
	}
	const path = join(directory, filename);
	writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 });
	return path;
}

function configureAndBuild({ buildDirectory, configure, arguments_, flags }) {
	run(emconfigure, [configure, ...arguments_], {
		cwd: buildDirectory,
		env: { ...environment, CFLAGS: flags.join(' ') },
	});
	run(emmake, ['make', '-j1'], { cwd: buildDirectory });
}

function archiveEvidence(path) {
	const output = run(emar, ['t', path], { capture: true });
	const members = output.split('\n').filter(Boolean);
	return Object.freeze({ count: members.length, sha256: sha256(`${members.join('\n')}\n`) });
}

function verifyArchiveEvidence(opus, ogg) {
	const expected = manifest.compiledArchiveEvidence;
	if (expected.opusMembersSha256 && (opus.count !== expected.opusMemberCount
		|| opus.sha256 !== expected.opusMembersSha256)) {
		throw new Error('The libopus compiled archive membership changed.');
	}
	if (expected.oggMembersSha256 && (ogg.count !== expected.oggMemberCount
		|| ogg.sha256 !== expected.oggMembersSha256)) {
		throw new Error('The libogg compiled archive membership changed.');
	}
}

function prefixMapFlags(source, label) {
	return [`-ffile-prefix-map=${source}=${label}`, `-fdebug-prefix-map=${source}=${label}`];
}

function verifyManifest() {
	if (manifest.schemaVersion !== 1 || manifest.opus.tag !== 'v1.6.1'
		|| manifest.opus.revision !== '22244de5a79bd1d6d623c32e72bf1954b56235be'
		|| manifest.opus.archiveSha256 !== '6ffcb593207be92584df15b32466ed64bbec99109f007c82205f0194572411a1'
		|| manifest.ogg.tag !== 'v1.3.6'
		|| manifest.ogg.revision !== 'be05b13e98b048f0b5a0f5fa8ce514d56db5f822'
		|| manifest.ogg.archiveSha256 !== '5c8253428e181840cd20d41f3ca16557a9cc04bad4a3d04cce84808677fa1061') {
		throw new Error('Ogg Opus source admission must remain pinned to official releases.');
	}
	if (manifest.toolchain.emscriptenVersion !== '3.1.64'
		|| manifest.wasm.initialMemoryBytes !== 8 * 1024 * 1024
		|| manifest.wasm.maximumMemoryBytes !== 256 * 1024 * 1024) {
		throw new Error('Ogg Opus build toolchain or linear-memory bounds changed.');
	}
	if (JSON.stringify(manifest.configureArguments.opus) !== JSON.stringify([
		'--disable-shared', '--enable-static', '--disable-dependency-tracking', '--disable-doc',
		'--disable-extra-programs', '--disable-asm', '--disable-rtcd', '--disable-intrinsics',
		'--disable-custom-modes', '--disable-opus-custom-api', '--disable-qext', '--disable-dred',
		'--disable-deep-plc', '--disable-lossgen', '--disable-osce', '--disable-osce-training-data',
	]) || JSON.stringify(manifest.configureArguments.ogg) !== JSON.stringify([
		'--disable-shared', '--enable-static', '--disable-dependency-tracking',
	])) throw new Error('Ogg Opus configure admission changed.');
}

function verifyLocalFiles() {
	for (const file of manifest.localFiles) {
		const actual = sha256(readFileSync(join(opusDirectory, file.path)));
		if (actual !== file.sha256) throw new Error(`Pinned Ogg Opus local file mismatch for ${file.path}: ${actual}.`);
	}
}

function verifyCompiler() {
	const result = spawnSync(emcc, ['--version'], { cwd: root, env: environment, encoding: 'utf8' });
	if (result.error?.code === 'ENOENT') {
		throw new Error(`${emcc} was not found. Use ${manifest.toolchain.dockerImage}.`);
	}
	if (result.status !== 0) throw new Error(`${emcc} --version failed:\n${result.stderr || result.stdout}`);
	if (!`${result.stdout}\n${result.stderr}`.includes(manifest.toolchain.emscriptenVersion)
		&& process.env.OPUS_ALLOW_TOOLCHAIN_MISMATCH !== '1') {
		throw new Error(`Expected Emscripten ${manifest.toolchain.emscriptenVersion}.`);
	}
}

function run(command, arguments_, options = {}) {
	const result = spawnSync(command, arguments_, {
		cwd: options.cwd ?? root, env: options.env ?? environment, encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(`${command} ${arguments_.join(' ')} failed:\n${result.stdout}${result.stderr}`);
	}
	return options.capture ? result.stdout : '';
}

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }

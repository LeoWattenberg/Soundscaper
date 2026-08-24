#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import {
	copyFileSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const flacDirectory = join(root, 'src/common/editor/flac');
const manifest = JSON.parse(readFileSync(join(flacDirectory, 'source-manifest.json'), 'utf8'));
const outputArgumentIndex = process.argv.indexOf('--output');
const outputPath = outputArgumentIndex >= 0
	? resolve(root, process.argv[outputArgumentIndex + 1])
	: join(flacDirectory, manifest.wasm.path);
const emcc = process.env.EMCC || 'emcc';
const environment = {
	...process.env,
	SOURCE_DATE_EPOCH: manifest.toolchain.sourceDateEpoch,
	TZ: 'UTC',
	LC_ALL: 'C',
};

verifyManifest();
verifyLocalFiles();
verifyCompiler();

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'soundscaper-flac-wasm-'));
try {
	const archivePath = join(temporaryDirectory, 'flac.tar.xz');
	const response = await fetch(manifest.flac.archiveUrl, { redirect: 'follow' });
	if (!response.ok || response.url !== manifest.flac.archiveRedirectUrl) {
		throw new Error(`Could not fetch the exact FLAC source archive (${String(response.status)}).`);
	}
	const archive = new Uint8Array(await response.arrayBuffer());
	if (archive.byteLength < 512 * 1024 || archive.byteLength > 2 * 1024 * 1024
		|| sha256(archive) !== manifest.flac.archiveSha256) {
		throw new Error('The FLAC source archive does not match its exact release digest.');
	}
	writeFileSync(archivePath, archive, { flag: 'wx', mode: 0o600 });
	run('tar', ['-xJf', archivePath, '-C', temporaryDirectory]);
	const sourceRoot = join(temporaryDirectory, `flac-${manifest.flac.tag}`);
	const objects = [];
	const commonArguments = [
		'-std=c11', '-O3', '-flto', '-mno-simd128', '-fno-fast-math',
		'-fno-finite-math-only', '-fvisibility=hidden', '-D_POSIX_C_SOURCE=200809L',
		'-DFLAC__HAS_OGG=0', '-DFLAC__NO_ASM=1',
		'-DFLAC__NO_DLL=1', '-DHAVE_FSEEKO=1', '-DHAVE_LROUND=1', '-DNDEBUG=1',
		'-DPACKAGE_VERSION="1.5.0"',
		`-I${join(sourceRoot, 'include')}`,
		`-I${join(sourceRoot, 'src/libFLAC/include')}`,
		`-ffile-prefix-map=${sourceRoot}=flac-1.5.0`, `-ffile-prefix-map=${root}=.`,
		`-fdebug-prefix-map=${sourceRoot}=flac-1.5.0`, `-fdebug-prefix-map=${root}=.`,
	];
	for (const source of manifest.compiledSources) {
		const object = join(temporaryDirectory, `${String(objects.length)}.o`);
		run(emcc, [...commonArguments, '-c', join(sourceRoot, source), '-o', object]);
		objects.push(object);
	}
	const wrapperObject = join(temporaryDirectory, `${String(objects.length)}.o`);
	run(emcc, [
		...commonArguments, '-c', join(flacDirectory, 'native/soundscaper_flac.c'),
		'-o', wrapperObject,
	]);
	objects.push(wrapperObject);

	const exportedFunctions = manifest.wasm.requiredExports
		.filter((name) => name.startsWith('scfl_'))
		.map((name) => `_${name}`);
	const temporaryOutput = join(temporaryDirectory, 'flac.wasm');
	run(emcc, [
		...objects, '-O3', '-flto', '-mno-simd128', '-fno-fast-math',
		'-fno-finite-math-only', '--no-entry', '-sSTANDALONE_WASM=1', '-sFILESYSTEM=0',
		'-sALLOW_MEMORY_GROWTH=1', `-sINITIAL_MEMORY=${String(manifest.wasm.initialMemoryBytes)}`,
		`-sMAXIMUM_MEMORY=${String(manifest.wasm.maximumMemoryBytes)}`,
		`-sSTACK_SIZE=${String(manifest.wasm.stackBytes)}`, '-sMALLOC=emmalloc',
		'-sASSERTIONS=0', '-sSUPPORT_LONGJMP=0', '-sDISABLE_EXCEPTION_CATCHING=1',
		'-sERROR_ON_UNDEFINED_SYMBOLS=1', `-sEXPORTED_FUNCTIONS=${JSON.stringify(exportedFunctions)}`,
		'-Wl,--strip-all', '-o', temporaryOutput,
	]);

	const bytes = readFileSync(temporaryOutput);
	const hash = sha256(bytes);
	if (bytes.byteLength > manifest.wasm.maximumBytes) {
		throw new Error(`FLAC WASM is ${String(bytes.byteLength)} bytes; limit is ${String(manifest.wasm.maximumBytes)}.`);
	}
	if (manifest.wasm.sha256 && hash !== manifest.wasm.sha256) {
		throw new Error(`FLAC WASM hash mismatch: expected ${manifest.wasm.sha256}, got ${hash}.`);
	}
	copyFileSync(temporaryOutput, outputPath);
	process.stdout.write(
		`Built ${relative(root, outputPath)} (${String(statSync(outputPath).size)} bytes)\nSHA-256 ${hash}\n`,
	);
	if (!manifest.wasm.sha256) {
		process.stdout.write('Bootstrap build: pin this hash in source-manifest.json, then rebuild.\n');
	}
} finally {
	rmSync(temporaryDirectory, { recursive: true, force: true });
}

function verifyManifest() {
	if (manifest.schemaVersion !== 1 || manifest.flac.tag !== '1.5.0'
		|| manifest.flac.revision !== '1507800de4b70e21be71f38caa0d9079d0bc6e45'
		|| manifest.flac.archiveSha256 !== 'f2c1c76592a82ffff8413ba3c4a1299b6c7ab06c734dee03fd88630485c2b920') {
		throw new Error('FLAC source admission must remain pinned to the official 1.5.0 release.');
	}
	if (manifest.toolchain.emscriptenVersion !== '3.1.64'
		|| manifest.wasm.initialMemoryBytes !== 8 * 1024 * 1024
		|| manifest.wasm.maximumMemoryBytes !== 256 * 1024 * 1024) {
		throw new Error('FLAC build toolchain or linear-memory bounds changed.');
	}
}

function verifyLocalFiles() {
	for (const file of manifest.localFiles) {
		const actual = sha256(readFileSync(join(flacDirectory, file.path)));
		if (actual !== file.sha256) {
			throw new Error(`Pinned FLAC local file mismatch for ${file.path}: ${actual}.`);
		}
	}
}

function verifyCompiler() {
	const result = spawnSync(emcc, ['--version'], { cwd: root, env: environment, encoding: 'utf8' });
	if (result.error?.code === 'ENOENT') {
		throw new Error(`${emcc} was not found. Use ${manifest.toolchain.dockerImage}.`);
	}
	if (result.status !== 0) throw new Error(`${emcc} --version failed:\n${result.stderr || result.stdout}`);
	const banner = `${result.stdout}\n${result.stderr}`;
	if (!banner.includes(manifest.toolchain.emscriptenVersion)
		&& process.env.FLAC_ALLOW_TOOLCHAIN_MISMATCH !== '1') {
		throw new Error(`Expected Emscripten ${manifest.toolchain.emscriptenVersion}.`);
	}
}

function run(command, arguments_) {
	const result = spawnSync(command, arguments_, {
		cwd: root, env: environment, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(`${command} ${arguments_.join(' ')} failed:\n${result.stdout}${result.stderr}`);
	}
}

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}

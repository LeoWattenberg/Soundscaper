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

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const twolameDirectory = join(root, 'src/common/editor/twolame');
const manifest = JSON.parse(readFileSync(join(twolameDirectory, 'source-manifest.json'), 'utf8'));
const outputArgumentIndex = process.argv.indexOf('--output');
const outputPath = outputArgumentIndex >= 0
	? resolve(root, process.argv[outputArgumentIndex + 1])
	: join(twolameDirectory, manifest.wasm.path);
const emcc = process.env.EMCC || 'emcc';
const emconfigure = process.env.EMCONFIGURE || 'emconfigure';
const emmake = process.env.EMMAKE || 'emmake';
const emar = process.env.EMAR || 'emar';
const environment = {
	...process.env,
	PKG_CONFIG: process.env.PKG_CONFIG || 'true',
	SOURCE_DATE_EPOCH: manifest.toolchain.sourceDateEpoch,
	TZ: 'UTC',
	LC_ALL: 'C',
};

verifyManifest();
verifyLocalFiles();
verifyCompiler();

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'soundscaper-twolame-wasm-'));
try {
	const archivePath = join(temporaryDirectory, 'twolame-0.4.0.tar.gz');
	const response = await fetch(manifest.twolame.archiveUrl, { redirect: 'follow' });
	if (!response.ok || !admittedSourceForgeUrl(response.url)) {
		throw new Error(`Could not fetch the exact TwoLAME source archive (${String(response.status)}).`);
	}
	const archive = new Uint8Array(await response.arrayBuffer());
	if (archive.byteLength < 512 * 1024 || archive.byteLength > 2 * 1024 * 1024
		|| sha256(archive) !== manifest.twolame.archiveSha256) {
		throw new Error('The TwoLAME source archive does not match its exact release digest.');
	}
	writeFileSync(archivePath, archive, { flag: 'wx', mode: 0o600 });
	run('tar', ['-xzf', archivePath, '-C', temporaryDirectory]);
	const sourceRoot = join(temporaryDirectory, 'twolame-0.4.0');
	const buildRoot = join(temporaryDirectory, 'build-twolame');
	mkdirSync(buildRoot);
	const commonFlags = [
		'-O3', '-flto', '-mno-simd128', '-fno-fast-math', '-fno-finite-math-only',
		'-fvisibility=hidden', '-DNDEBUG=1',
		`-ffile-prefix-map=${sourceRoot}=twolame-0.4.0`,
		`-fdebug-prefix-map=${sourceRoot}=twolame-0.4.0`,
		`-ffile-prefix-map=${root}=.`, `-fdebug-prefix-map=${root}=.`,
	];
	run(emconfigure, [join(sourceRoot, 'configure'), ...manifest.configureArguments], {
		cwd: buildRoot, env: { ...environment, CFLAGS: commonFlags.join(' ') },
	});
	run(emmake, ['make', '-C', 'libtwolame', '-j1'], { cwd: buildRoot });
	const library = join(buildRoot, 'libtwolame/.libs/libtwolame.a');
	const members = archiveEvidence(library);
	verifyArchiveEvidence(members);
	const exportedFunctions = manifest.wasm.requiredExports
		.filter((name) => name.startsWith('sctl_'))
		.map((name) => `_${name}`);
	const temporaryOutput = join(temporaryDirectory, 'twolame.wasm');
	run(emcc, [
		join(twolameDirectory, 'native/soundscaper_twolame.c'), library,
		`-I${join(sourceRoot, 'libtwolame')}`, '-DLIBTWOLAME_STATIC=1', '-std=c11',
		...commonFlags, '--no-entry', '-sSTANDALONE_WASM=1', '-sFILESYSTEM=0',
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
		throw new Error(`TwoLAME WASM is ${String(bytes.byteLength)} bytes; limit is ${String(manifest.wasm.maximumBytes)}.`);
	}
	if (manifest.wasm.sha256 && hash !== manifest.wasm.sha256) {
		throw new Error(`TwoLAME WASM hash mismatch: expected ${manifest.wasm.sha256}, got ${hash}.`);
	}
	mkdirSync(dirname(outputPath), { recursive: true });
	copyFileSync(temporaryOutput, outputPath);
	process.stdout.write(
		`Built ${relative(root, outputPath)} (${String(statSync(outputPath).size)} bytes)\n`
		+ `SHA-256 ${hash}\n`
		+ `libtwolame archive ${String(members.count)} members, SHA-256 ${members.sha256}\n`,
	);
	if (!manifest.wasm.sha256 || !manifest.compiledArchiveEvidence.membersSha256) {
		process.stdout.write('Bootstrap build: pin the artifact and archive-member evidence, then rebuild.\n');
	}
} finally {
	rmSync(temporaryDirectory, { recursive: true, force: true });
}

function admittedSourceForgeUrl(value) {
	let url;
	try { url = new URL(value); }
	catch { return false; }
	return url.protocol === 'https:'
		&& (url.hostname === 'downloads.sourceforge.net' || url.hostname.endsWith('.dl.sourceforge.net'))
		&& url.pathname.endsWith('/project/twolame/twolame/0.4.0/twolame-0.4.0.tar.gz');
}

function archiveEvidence(path) {
	const output = run(emar, ['t', path], { capture: true });
	const members = output.split('\n').filter(Boolean);
	return Object.freeze({ count: members.length, sha256: sha256(`${members.join('\n')}\n`) });
}

function verifyArchiveEvidence(actual) {
	const expected = manifest.compiledArchiveEvidence;
	if (expected.membersSha256 && (actual.count !== expected.memberCount
		|| actual.sha256 !== expected.membersSha256)) {
		throw new Error('The libtwolame compiled archive membership changed.');
	}
}

function verifyManifest() {
	if (manifest.schemaVersion !== 1 || manifest.twolame.tag !== '0.4.0'
		|| manifest.twolame.revision !== 'bec4069996479aa1aa9d9e7fa32c33135b3a2047'
		|| manifest.twolame.license !== 'LGPL-2.1-or-later'
		|| manifest.twolame.archiveSha256 !== 'cc35424f6019a88c6f52570b63e1baf50f62963a3eac52a03a800bb070d7c87d') {
		throw new Error('TwoLAME source admission must remain pinned to official 0.4.0.');
	}
	if (manifest.toolchain.emscriptenVersion !== '3.1.64'
		|| manifest.toolchain.dockerImageDigest !== 'sha256:8847dad4171ebc8a53d9ae5cda86a2546ef5b2e68834c14dc1ba2b2962e125cc'
		|| manifest.wasm.initialMemoryBytes !== 8 * 1024 * 1024
		|| manifest.wasm.maximumMemoryBytes !== 256 * 1024 * 1024) {
		throw new Error('TwoLAME build toolchain or linear-memory bounds changed.');
	}
	if (JSON.stringify(manifest.configureArguments) !== JSON.stringify([
		'--disable-shared', '--enable-static', '--disable-dependency-tracking', '--disable-sndfile',
	])) throw new Error('TwoLAME configure admission changed.');
}

function verifyLocalFiles() {
	for (const file of manifest.localFiles) {
		const actual = sha256(readFileSync(join(twolameDirectory, file.path)));
		if (actual !== file.sha256) throw new Error(`Pinned TwoLAME local file mismatch for ${file.path}: ${actual}.`);
	}
}

function verifyCompiler() {
	const result = spawnSync(emcc, ['--version'], { cwd: root, env: environment, encoding: 'utf8' });
	if (result.error?.code === 'ENOENT') {
		throw new Error(`${emcc} was not found. Use ${manifest.toolchain.dockerImage}.`);
	}
	if (result.status !== 0) throw new Error(`${emcc} --version failed:\n${result.stderr || result.stdout}`);
	if (!`${result.stdout}\n${result.stderr}`.includes(manifest.toolchain.emscriptenVersion)
		&& process.env.TWOLAME_ALLOW_TOOLCHAIN_MISMATCH !== '1') {
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

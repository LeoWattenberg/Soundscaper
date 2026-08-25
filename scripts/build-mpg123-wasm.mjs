#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import {
	chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDirectory = join(root, 'src/common/editor/mpg123');
const manifest = JSON.parse(readFileSync(join(sourceDirectory, 'source-manifest.json'), 'utf8'));
const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex >= 0
	? resolve(root, process.argv[outputIndex + 1]) : join(sourceDirectory, manifest.wasm.path);
const emcc = process.env.EMCC || 'emcc';
const emconfigure = process.env.EMCONFIGURE || 'emconfigure';
const emmake = process.env.EMMAKE || 'emmake';
const emar = process.env.EMAR || 'emar';
const environment = {
	...process.env, SOURCE_DATE_EPOCH: manifest.toolchain.sourceDateEpoch, TZ: 'UTC', LC_ALL: 'C',
};

verifyManifest();
verifyLocalFiles();
verifyCompiler();

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'soundscaper-mpg123-wasm-'));
try {
	const archivePath = join(temporaryDirectory, 'mpg123.tar.bz2');
	const signaturePath = join(temporaryDirectory, 'mpg123.tar.bz2.sig');
	const keyPath = join(temporaryDirectory, 'signing-key.asc');
	const [archive, signature, signingKey] = await Promise.all([
		fetchPinned(manifest.mpg123.archiveUrl, manifest.mpg123.archiveRedirectUrl,
			manifest.mpg123.archiveSha256, 512 * 1024, 4 * 1024 * 1024, 'source archive'),
		fetchPinned(manifest.mpg123.signatureUrl, manifest.mpg123.signatureRedirectUrl,
			manifest.mpg123.signatureSha256, 256, 4 * 1024, 'detached signature'),
		fetchPinned(manifest.mpg123.signingKeyUrl, manifest.mpg123.signingKeyRedirectUrl,
			manifest.mpg123.signingKeySha256, 1024, 16 * 1024, 'signing key'),
	]);
	writeFileSync(archivePath, archive, { flag: 'wx', mode: 0o600 });
	writeFileSync(signaturePath, signature, { flag: 'wx', mode: 0o600 });
	writeFileSync(keyPath, signingKey, { flag: 'wx', mode: 0o600 });
	verifySignature({ archivePath, signaturePath, keyPath, temporaryDirectory });
	run('tar', ['-xjf', archivePath, '-C', temporaryDirectory]);
	const upstream = join(temporaryDirectory, 'mpg123-1.33.7');
	const buildDirectory = join(temporaryDirectory, 'build');
	mkdirSync(buildDirectory);
	const commonFlags = [
		'-O3', '-flto', '-mno-simd128', '-fno-fast-math', '-fno-finite-math-only',
		'-fvisibility=hidden', '-DNDEBUG=1',
		`-ffile-prefix-map=${upstream}=mpg123-1.33.7`, `-fdebug-prefix-map=${upstream}=mpg123-1.33.7`,
		`-ffile-prefix-map=${root}=.`, `-fdebug-prefix-map=${root}=.`,
	];
	run(emconfigure, [join(upstream, 'configure'), ...manifest.configureArguments], {
		cwd: buildDirectory, env: { ...environment, CFLAGS: commonFlags.join(' ') },
	});
	run(emmake, ['make', '-j1'], { cwd: buildDirectory });
	const library = join(buildDirectory, 'src/libmpg123/.libs/libmpg123.a');
	const members = archiveEvidence(library);
	if (manifest.compiledArchiveEvidence.membersSha256
		&& (members.count !== manifest.compiledArchiveEvidence.memberCount
			|| members.sha256 !== manifest.compiledArchiveEvidence.membersSha256)) {
		throw new Error('The libmpg123 compiled archive membership changed.');
	}
	const exports = manifest.wasm.requiredExports
		.filter((name) => name.startsWith('scmp_')).map((name) => `_${name}`);
	const temporaryOutput = join(temporaryDirectory, 'mpg123.wasm');
	run(emcc, [
		join(sourceDirectory, 'native/soundscaper_mpg123.c'), library,
		`-I${join(upstream, 'src/include')}`, `-I${join(buildDirectory, 'src')}`,
		'-std=c11', ...commonFlags, '--no-entry', '-sSTANDALONE_WASM=1', '-sFILESYSTEM=0',
		'-sALLOW_MEMORY_GROWTH=1', `-sINITIAL_MEMORY=${String(manifest.wasm.initialMemoryBytes)}`,
		`-sMAXIMUM_MEMORY=${String(manifest.wasm.maximumMemoryBytes)}`,
		`-sSTACK_SIZE=${String(manifest.wasm.stackBytes)}`, '-sMALLOC=emmalloc',
		'-sASSERTIONS=0', '-sSUPPORT_LONGJMP=0', '-sDISABLE_EXCEPTION_CATCHING=1',
		'-sERROR_ON_UNDEFINED_SYMBOLS=1', `-sEXPORTED_FUNCTIONS=${JSON.stringify(exports)}`,
		'-Wl,--strip-all', '-o', temporaryOutput,
	]);
	const bytes = readFileSync(temporaryOutput);
	const hash = sha256(bytes);
	if (bytes.byteLength > manifest.wasm.maximumBytes) {
		throw new Error(`mpg123 WASM is ${String(bytes.byteLength)} bytes; limit is ${String(manifest.wasm.maximumBytes)}.`);
	}
	if (manifest.wasm.sha256 && hash !== manifest.wasm.sha256) {
		throw new Error(`mpg123 WASM hash mismatch: expected ${manifest.wasm.sha256}, got ${hash}.`);
	}
	mkdirSync(dirname(outputPath), { recursive: true });
	copyFileSync(temporaryOutput, outputPath);
	process.stdout.write(
		`Built ${relative(root, outputPath)} (${String(statSync(outputPath).size)} bytes)\nSHA-256 ${hash}\n`
		+ `libmpg123 archive ${String(members.count)} members, SHA-256 ${members.sha256}\n`,
	);
	if (!manifest.wasm.sha256 || !manifest.compiledArchiveEvidence.membersSha256) {
		process.stdout.write('Bootstrap build: pin the artifact and archive-member evidence, then rebuild.\n');
	}
} finally {
	rmSync(temporaryDirectory, { recursive: true, force: true });
}

async function fetchPinned(url, redirectedUrl, digest, minimumBytes, maximumBytes, label) {
	const response = await fetch(url, { redirect: 'follow' });
	if (!response.ok || response.url !== redirectedUrl) {
		throw new Error(`Could not fetch the exact mpg123 ${label} (${String(response.status)}).`);
	}
	const bytes = new Uint8Array(await response.arrayBuffer());
	if (bytes.byteLength < minimumBytes || bytes.byteLength > maximumBytes || sha256(bytes) !== digest) {
		throw new Error(`The mpg123 ${label} does not match its exact digest.`);
	}
	return bytes;
}

function verifySignature({ archivePath, signaturePath, keyPath, temporaryDirectory }) {
	const home = join(temporaryDirectory, 'gnupg');
	mkdirSync(home);
	chmodSync(home, 0o700);
	run('gpg', ['--batch', '--homedir', home, '--import', keyPath]);
	const fingerprints = run('gpg', [
		'--batch', '--homedir', home, '--with-colons', '--fingerprint',
	], { capture: true }).split('\n').filter((line) => line.startsWith('fpr:'));
	if (!fingerprints.some((line) => line.split(':')[9] === manifest.mpg123.signingFingerprint)) {
		throw new Error('The mpg123 signing-key fingerprint changed.');
	}
	const status = run('gpg', [
		'--batch', '--homedir', home, '--status-fd=1', '--verify', signaturePath, archivePath,
	], { capture: true });
	if (!status.includes(`[GNUPG:] VALIDSIG ${manifest.mpg123.signingFingerprint} `)) {
		throw new Error('The mpg123 detached signature is not valid for the pinned key.');
	}
}

function archiveEvidence(path) {
	const members = run(emar, ['t', path], { capture: true }).split('\n').filter(Boolean);
	return Object.freeze({ count: members.length, sha256: sha256(`${members.join('\n')}\n`) });
}

function verifyManifest() {
	const source = manifest.mpg123;
	if (manifest.schemaVersion !== 1 || source.version !== '1.33.7'
		|| source.license !== 'LGPL-2.1-only'
		|| source.archiveSha256 !== '31d0e35a4ca567ec9b5ebda6c3062bb4435d6d3eacd6ef0d95cadd7854dc03ee'
		|| source.signatureSha256 !== '48037de26dd56d479b5a54d91ba301d9958476bd03c1b135ee183c3b23c2793c'
		|| source.signingFingerprint !== 'D021FF8ECF4BE09719D61A27231C4CBC60D5CAFE') {
		throw new Error('mpg123 source admission must remain pinned to the signed official 1.33.7 release.');
	}
	if (manifest.toolchain.emscriptenVersion !== '3.1.64'
		|| manifest.wasm.initialMemoryBytes !== 8 * 1024 * 1024
		|| manifest.wasm.maximumMemoryBytes !== 256 * 1024 * 1024) {
		throw new Error('mpg123 build toolchain or linear-memory bounds changed.');
	}
}

function verifyLocalFiles() {
	for (const file of manifest.localFiles) {
		const actual = sha256(readFileSync(join(sourceDirectory, file.path)));
		if (actual !== file.sha256) throw new Error(`Pinned mpg123 local file mismatch for ${file.path}: ${actual}.`);
	}
}

function verifyCompiler() {
	const result = spawnSync(emcc, ['--version'], { cwd: root, env: environment, encoding: 'utf8' });
	if (result.error?.code === 'ENOENT') throw new Error(`${emcc} was not found. Use ${manifest.toolchain.dockerImage}.`);
	if (result.status !== 0) throw new Error(`${emcc} --version failed:\n${result.stderr || result.stdout}`);
	if (!`${result.stdout}\n${result.stderr}`.includes(manifest.toolchain.emscriptenVersion)
		&& process.env.MPG123_ALLOW_TOOLCHAIN_MISMATCH !== '1') {
		throw new Error(`Expected Emscripten ${manifest.toolchain.emscriptenVersion}.`);
	}
}

function run(command, arguments_, options = {}) {
	const result = spawnSync(command, arguments_, {
		cwd: options.cwd ?? root, env: options.env ?? environment, encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`${command} ${arguments_.join(' ')} failed:\n${result.stdout}${result.stderr}`);
	return options.capture ? result.stdout : '';
}

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }

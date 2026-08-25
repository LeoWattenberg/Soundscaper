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
const vorbisDirectory = join(root, 'src/common/editor/vorbis');
const manifest = JSON.parse(readFileSync(join(vorbisDirectory, 'source-manifest.json'), 'utf8'));
const outputArgumentIndex = process.argv.indexOf('--output');
const outputPath = outputArgumentIndex >= 0
	? resolve(root, process.argv[outputArgumentIndex + 1])
	: join(vorbisDirectory, manifest.wasm.path);
const emcc = process.env.EMCC || 'emcc';
const emconfigure = process.env.EMCONFIGURE || 'emconfigure';
const emmake = process.env.EMMAKE || 'emmake';
const emar = process.env.EMAR || 'emar';
const environment = {
	...process.env, SOURCE_DATE_EPOCH: manifest.toolchain.sourceDateEpoch,
	TZ: 'UTC', LC_ALL: 'C',
};

verifyManifest();
verifyLocalFiles();
verifyCompiler();

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'soundscaper-vorbis-wasm-'));
try {
	const vorbisArchive = await fetchArchive(manifest.vorbis, temporaryDirectory, 'vorbis.tar.xz');
	const oggArchive = await fetchArchive(manifest.ogg, temporaryDirectory, 'ogg.tar.xz');
	run('tar', ['-xJf', vorbisArchive, '-C', temporaryDirectory]);
	run('tar', ['-xJf', oggArchive, '-C', temporaryDirectory]);
	const vorbisSource = join(temporaryDirectory, 'libvorbis-1.3.7');
	const oggSource = join(temporaryDirectory, 'libogg-1.3.6');
	const vorbisBuild = join(temporaryDirectory, 'build-vorbis');
	const oggBuild = join(temporaryDirectory, 'build-ogg');
	const prefix = join(temporaryDirectory, 'prefix');
	mkdirSync(vorbisBuild);
	mkdirSync(oggBuild);
	mkdirSync(prefix);
	const commonFlags = [
		'-O3', '-flto', '-mno-simd128', '-fno-fast-math', '-fno-finite-math-only',
		'-fvisibility=hidden', '-DNDEBUG=1',
	];
	configureAndBuild({
		buildDirectory: oggBuild, configure: join(oggSource, 'configure'),
		arguments_: [`--prefix=${prefix}`, ...manifest.configureArguments.ogg],
		flags: [...commonFlags, ...prefixMapFlags(oggSource, 'libogg-1.3.6')],
		install: true,
	});
	configureAndBuild({
		buildDirectory: vorbisBuild, configure: join(vorbisSource, 'configure'),
		arguments_: [`--prefix=${prefix}`, ...manifest.configureArguments.vorbis],
		flags: [...commonFlags, ...prefixMapFlags(vorbisSource, 'libvorbis-1.3.7')],
		extraEnvironment: {
			CPPFLAGS: `-I${join(prefix, 'include')}`,
			LDFLAGS: `-L${join(prefix, 'lib')}`,
		},
	});
	const libraries = Object.freeze({
		vorbis: join(vorbisBuild, 'lib/.libs/libvorbis.a'),
		vorbisEnc: join(vorbisBuild, 'lib/.libs/libvorbisenc.a'),
		vorbisFile: join(vorbisBuild, 'lib/.libs/libvorbisfile.a'),
		ogg: join(oggBuild, 'src/.libs/libogg.a'),
	});
	const evidence = Object.freeze(Object.fromEntries(
		Object.entries(libraries).map(([name, path]) => [name, archiveEvidence(path)]),
	));
	verifyArchiveEvidence(evidence);
	const exportedFunctions = manifest.wasm.requiredExports
		.filter((name) => name.startsWith('scvb_'))
		.map((name) => `_${name}`);
	const temporaryOutput = join(temporaryDirectory, 'vorbis.wasm');
	run(emcc, [
		join(vorbisDirectory, 'native/soundscaper_vorbis.c'),
		libraries.vorbisFile, libraries.vorbisEnc, libraries.vorbis, libraries.ogg,
		`-I${join(prefix, 'include')}`, `-I${join(vorbisSource, 'include')}`,
		`-I${join(oggSource, 'include')}`, `-I${join(oggBuild, 'include')}`,
		'-std=c11', ...commonFlags,
		...prefixMapFlags(vorbisSource, 'libvorbis-1.3.7'),
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
		throw new Error(`Ogg Vorbis WASM is ${String(bytes.byteLength)} bytes; limit is ${String(manifest.wasm.maximumBytes)}.`);
	}
	if (manifest.wasm.sha256 && hash !== manifest.wasm.sha256) {
		throw new Error(`Ogg Vorbis WASM hash mismatch: expected ${manifest.wasm.sha256}, got ${hash}.`);
	}
	mkdirSync(dirname(outputPath), { recursive: true });
	copyFileSync(temporaryOutput, outputPath);
	process.stdout.write(
		`Built ${relative(root, outputPath)} (${String(statSync(outputPath).size)} bytes)\nSHA-256 ${hash}\n`
		+ Object.entries(evidence).map(([name, entry]) => (
			`${name} archive ${String(entry.count)} members, SHA-256 ${entry.sha256}`
		)).join('\n') + '\n',
	);
	if (!manifest.wasm.sha256) process.stdout.write('Bootstrap build: pin the artifact digest, then rebuild.\n');
} finally {
	rmSync(temporaryDirectory, { recursive: true, force: true });
}

async function fetchArchive(admission, directory, filename) {
	const response = await fetch(admission.archiveUrl, { redirect: 'follow' });
	if (!response.ok || response.url !== admission.archiveRedirectUrl) {
		throw new Error(`Could not fetch exact ${admission.tag} source archive (${String(response.status)}).`);
	}
	const bytes = new Uint8Array(await response.arrayBuffer());
	if (bytes.byteLength < 256 * 1024 || bytes.byteLength > 16 * 1024 * 1024
		|| sha256(bytes) !== admission.archiveSha256) {
		throw new Error(`The ${admission.tag} source archive does not match its exact release digest.`);
	}
	const path = join(directory, filename);
	writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 });
	return path;
}

function configureAndBuild({
	buildDirectory, configure, arguments_, flags, extraEnvironment = {}, install = false,
}) {
	const configureEnvironment = {
		...environment, ...extraEnvironment, CFLAGS: flags.join(' '),
	};
	run(emconfigure, [configure, ...arguments_], { cwd: buildDirectory, env: configureEnvironment });
	run(emmake, ['make', '-j1'], { cwd: buildDirectory });
	if (install) run(emmake, ['make', 'install'], { cwd: buildDirectory });
}

function archiveEvidence(path) {
	const output = run(emar, ['t', path], { capture: true });
	const members = output.split('\n').filter(Boolean);
	return Object.freeze({ count: members.length, sha256: sha256(`${members.join('\n')}\n`) });
}

function verifyArchiveEvidence(evidence) {
	const expected = manifest.compiledArchiveEvidence;
	for (const [name, prefix] of [
		['vorbis', 'vorbis'], ['vorbisEnc', 'vorbisEnc'],
		['vorbisFile', 'vorbisFile'], ['ogg', 'ogg'],
	]) {
		if (evidence[name].count !== expected[`${prefix}MemberCount`]
			|| evidence[name].sha256 !== expected[`${prefix}MembersSha256`]) {
			throw new Error(`The ${name} compiled archive membership changed.`);
		}
	}
}

function prefixMapFlags(source, label) {
	return [`-ffile-prefix-map=${source}=${label}`, `-fdebug-prefix-map=${source}=${label}`];
}

function verifyManifest() {
	if (manifest.schemaVersion !== 1 || manifest.vorbis.tag !== 'v1.3.7'
		|| manifest.vorbis.revision !== '0657aee69dec8508a0011f47f3b69d7538e9d262'
		|| manifest.vorbis.archiveSha256 !== 'b33cc4934322bcbf6efcbacf49e3ca01aadbea4114ec9589d1b1e9d20f72954b'
		|| manifest.ogg.tag !== 'v1.3.6'
		|| manifest.ogg.revision !== 'be05b13e98b048f0b5a0f5fa8ce514d56db5f822'
		|| manifest.ogg.archiveSha256 !== '5c8253428e181840cd20d41f3ca16557a9cc04bad4a3d04cce84808677fa1061') {
		throw new Error('Ogg Vorbis source admission must remain pinned to official releases.');
	}
	if (manifest.toolchain.emscriptenVersion !== '3.1.64'
		|| manifest.wasm.initialMemoryBytes !== 8 * 1024 * 1024
		|| manifest.wasm.maximumMemoryBytes !== 256 * 1024 * 1024) {
		throw new Error('Ogg Vorbis build toolchain or linear-memory bounds changed.');
	}
}

function verifyLocalFiles() {
	for (const file of manifest.localFiles) {
		const actual = sha256(readFileSync(join(vorbisDirectory, file.path)));
		if (actual !== file.sha256) throw new Error(`Pinned Ogg Vorbis local file mismatch for ${file.path}: ${actual}.`);
	}
}

function verifyCompiler() {
	const result = spawnSync(emcc, ['--version'], { cwd: root, env: environment, encoding: 'utf8' });
	if (result.error?.code === 'ENOENT') {
		throw new Error(`${emcc} was not found. Use ${manifest.toolchain.dockerImage}.`);
	}
	if (result.status !== 0) throw new Error(`${emcc} --version failed:\n${result.stderr || result.stdout}`);
	if (!`${result.stdout}\n${result.stderr}`.includes(manifest.toolchain.emscriptenVersion)
		&& process.env.VORBIS_ALLOW_TOOLCHAIN_MISMATCH !== '1') {
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

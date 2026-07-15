#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import {
	copyFileSync,
	cpSync,
	existsSync,
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
const nyquistDirectory = join(root, 'src/lib/tools/audio-editor/nyquist');
const nativeDirectory = join(nyquistDirectory, 'native');
const manifest = JSON.parse(readFileSync(join(nyquistDirectory, 'source-manifest.json'), 'utf8'));
const outputIndex = process.argv.indexOf('--output');
const sourceIndex = process.argv.indexOf('--audacity-source');
const outputPath = outputIndex >= 0
	? resolve(root, process.argv[outputIndex + 1])
	: join(nyquistDirectory, manifest.wasm.path);
const defaultTemporaryCheckout = '/tmp/soundscaper-audacity-3.7.7';
const audacityRoot = resolve(sourceIndex >= 0
	? process.argv[sourceIndex + 1]
	: process.env.AUDACITY_SOURCE_DIR || (existsSync(defaultTemporaryCheckout) ? defaultTemporaryCheckout : ''));
const libnyquist = join(audacityRoot, 'lib-src/libnyquist');
const runtimeDirectory = join(audacityRoot, 'nyquist');
const emcc = process.env.EMCC || 'emcc';
const emxx = process.env.EMXX || 'em++';
const environment = {
	...process.env,
	SOURCE_DATE_EPOCH: manifest.toolchain.sourceDateEpoch,
	TZ: 'UTC',
	LC_ALL: 'C',
};

if (!audacityRoot || !existsSync(libnyquist)) {
	throw new Error('Pass --audacity-source /path/to/audacity-3.7.7 or set AUDACITY_SOURCE_DIR.');
}
verifyRevision();
verifyCompiler(emcc);
verifyCompiler(emxx);
verifyLocalSources();

const cmakeSources = parseCmakeSources(readFileSync(join(libnyquist, 'CMakeLists.txt'), 'utf8'));
const skippedDesktopSources = new Set([
	'nyquist/cmupv/src/cmupvdbg.c',
	'nyquist/nyqsrc/multiread.c',
	'nyquist/nyqsrc/sndread.c',
	'nyquist/nyqsrc/sndwritepa.c',
]);
const upstreamSources = cmakeSources.filter((source) => !skippedDesktopSources.has(source));
verifyUpstreamTree(cmakeSources);

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'soundscaper-nyquist-wasm-'));
try {
	const patchedLibnyquist = join(temporaryDirectory, 'libnyquist');
	cpSync(libnyquist, patchedLibnyquist, { recursive: true });
	run('git', ['apply', '--unsafe-paths', join(nativeDirectory, 'patches/nyx-browser.patch')], patchedLibnyquist);
	const generatedRuntime = join(temporaryDirectory, 'nyquist_runtime.c');
	writeFileSync(generatedRuntime, generateRuntimeSource());

	const sources = upstreamSources.map((source) => join(patchedLibnyquist, source));
	sources.push(
		join(nativeDirectory, 'nyquist_io_stubs.c'),
		join(nativeDirectory, 'nyquist_wasm.c'),
		generatedRuntime,
	);

	const includeDirectories = [
		nativeDirectory,
		patchedLibnyquist,
		join(patchedLibnyquist, 'nyquist/cmt'),
		join(patchedLibnyquist, 'nyquist/cmupv/src'),
		join(patchedLibnyquist, 'nyquist/ffts/src'),
		join(patchedLibnyquist, 'nyquist/nyqsrc'),
		join(patchedLibnyquist, 'nyquist/nyqstk'),
		join(patchedLibnyquist, 'nyquist/nyqstk/include'),
		join(patchedLibnyquist, 'nyquist/tran'),
		join(patchedLibnyquist, 'nyquist/xlisp'),
		join(patchedLibnyquist, 'nyquist/sys/unix'),
	];
	const commonCompileArguments = [
		...includeDirectories.map((directory) => `-I${directory}`),
		'-DUSE_NYQUIST=1',
		'-DCMTSTUFF=1',
		'-DEXT=1',
		'-DUNIX=1',
		'-D_GNU_SOURCE=1',
		'-DXL_LITTLE_ENDIAN=1',
		'-O3',
		'-ffp-contract=off',
		'-Wno-register',
		'-sSUPPORT_LONGJMP=wasm',
		`-ffile-prefix-map=${root}=.`,
		`-ffile-prefix-map=${audacityRoot}=audacity`,
		`-ffile-prefix-map=${temporaryDirectory}=build`,
		`-fdebug-prefix-map=${root}=.`,
		`-fdebug-prefix-map=${audacityRoot}=audacity`,
		`-fdebug-prefix-map=${temporaryDirectory}=build`,
	];
	const objects = [];
	for (const [index, source] of sources.entries()) {
		const isC = source.endsWith('.c');
		const object = join(temporaryDirectory, `${index}.o`);
		run(isC ? emcc : emxx, [
			isC ? '-std=gnu11' : '-std=gnu++17',
			...commonCompileArguments,
			'-c', source,
			'-o', object,
		], root);
		objects.push(object);
	}

	const exportedFunctions = manifest.wasm.requiredExports
		.filter((name) => name !== 'memory' && name !== '_initialize')
		.map((name) => `_${name}`);
	const temporaryOutput = join(temporaryDirectory, 'nyquist.wasm');
	run(emxx, [
		...objects,
		'-O3',
		'-ffp-contract=off',
		`-ffile-prefix-map=${root}=.`,
		`-ffile-prefix-map=${audacityRoot}=audacity`,
		`-fdebug-prefix-map=${root}=.`,
		`-fdebug-prefix-map=${audacityRoot}=audacity`,
		'--no-entry',
		'-sSTANDALONE_WASM=1',
		'-sFILESYSTEM=0',
		'-sALLOW_MEMORY_GROWTH=1',
		`-sINITIAL_MEMORY=${manifest.wasm.initialMemoryBytes}`,
		`-sMAXIMUM_MEMORY=${manifest.wasm.maximumMemoryBytes}`,
		'-sMALLOC=emmalloc',
		'-sASSERTIONS=0',
		'-sSUPPORT_LONGJMP=wasm',
		'-sDISABLE_EXCEPTION_CATCHING=1',
		'-sERROR_ON_UNDEFINED_SYMBOLS=1',
		`-sEXPORTED_FUNCTIONS=${JSON.stringify(exportedFunctions)}`,
		'-Wl,--strip-all',
		'-o', temporaryOutput,
	], root);

	const bytes = readFileSync(temporaryOutput);
	const hash = sha256(bytes);
	if (bytes.byteLength > manifest.wasm.maximumBytes) {
		throw new Error(`Nyquist WASM is ${bytes.byteLength} bytes; limit is ${manifest.wasm.maximumBytes}.`);
	}
	if (manifest.wasm.sha256 && hash !== manifest.wasm.sha256) {
		throw new Error(`Nyquist WASM hash mismatch: expected ${manifest.wasm.sha256}, got ${hash}.`);
	}
	copyFileSync(temporaryOutput, outputPath);
	process.stdout.write(`Built ${relative(root, outputPath)} (${statSync(outputPath).size} bytes)\nSHA-256 ${hash}\n`);
	if (!manifest.wasm.sha256) {
		process.stdout.write('Bootstrap build: pin this hash in source-manifest.json and rebuild.\n');
	}
} finally {
	rmSync(temporaryDirectory, { recursive: true, force: true });
}

function parseCmakeSources(source) {
	const block = source.match(/set\( SOURCES([\s\S]*?)\n\)/)?.[1];
	if (!block) throw new Error('Could not parse libnyquist CMake source list.');
	return block.split('\n')
		.map((line) => line.replace(/#.*/, '').trim())
		.filter((line) => line && line !== 'PRIVATE');
}

function generateRuntimeSource() {
	const overrides = new Map([
		['init.lsp', join(nativeDirectory, 'browser-init.lsp')],
		['nyinit.lsp', join(nativeDirectory, 'browser-nyinit.lsp')],
		['system.lsp', join(nativeDirectory, 'browser-system.lsp')],
	]);
	const files = manifest.runtime.files.map((entry) => ({
		name: entry.path,
		bytes: readFileSync(overrides.get(entry.path) || join(runtimeDirectory, entry.path)),
	}));
	const declarations = files.map(({ name, bytes }, index) => {
		const values = [...bytes].map((value) => `0x${value.toString(16).padStart(2, '0')}`);
		const rows = [];
		for (let offset = 0; offset < values.length; offset += 24) {
			rows.push(`    ${values.slice(offset, offset + 24).join(', ')}`);
		}
		return `static unsigned char runtime_${index}[] = {\n${rows.join(',\n')}\n}; /* ${name} */`;
	}).join('\n\n');
	const cases = files.map(({ name, bytes }, index) =>
		`    if (strcmp(base, ${JSON.stringify(name)}) == 0) return fmemopen(runtime_${index}, ${bytes.length}, "r");`).join('\n');
	return `/* Generated from the pinned Audacity Nyquist runtime. */\n` +
		`#define _GNU_SOURCE 1\n#include "nyquist_browser.h"\n#include <string.h>\n\n${declarations}\n\n` +
		`FILE *nyquist_runtime_open(const char *name, const char *mode)\n{\n` +
		`    const char *base;\n    if (!name || !mode || !strchr(mode, 'r') || strchr(mode, 'w') || strchr(mode, 'a') || strchr(mode, '+')) return NULL;\n` +
		`    base = strrchr(name, '/');\n    base = base ? base + 1 : name;\n${cases}\n    return NULL;\n}\n`;
}

function verifyRevision() {
	const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: audacityRoot, encoding: 'utf8' });
	if (result.status !== 0 || result.stdout.trim() !== manifest.audacity.revision) {
		throw new Error(`Audacity source must be exact revision ${manifest.audacity.revision}.`);
	}
}

function verifyCompiler(command) {
	const result = spawnSync(command, ['--version'], { cwd: root, env: environment, encoding: 'utf8' });
	if (result.error?.code === 'ENOENT') {
		throw new Error(`${command} was not found. Install Emscripten ${manifest.toolchain.emscriptenVersion}.`);
	}
	if (result.status !== 0) throw new Error(`${command} --version failed.`);
	const banner = `${result.stdout}\n${result.stderr}`;
	if (!banner.includes(manifest.toolchain.emscriptenVersion) && process.env.NYQUIST_ALLOW_TOOLCHAIN_MISMATCH !== '1') {
		throw new Error(`Expected Emscripten ${manifest.toolchain.emscriptenVersion}.`);
	}
}

function verifyLocalSources() {
	for (const source of manifest.localSources) {
		const actual = sha256(readFileSync(join(nyquistDirectory, source.path)));
		if (actual !== source.sha256) throw new Error(`Local source hash mismatch for ${source.path}: ${actual}`);
	}
}

function verifyUpstreamTree(sources) {
	const hash = createHash('sha256');
	for (const source of [...sources].sort()) {
		hash.update(`${source}\0`);
		hash.update(readFileSync(join(libnyquist, source)));
	}
	for (const entry of manifest.runtime.files) {
		if (['init.lsp', 'nyinit.lsp', 'system.lsp'].includes(entry.path)) continue;
		hash.update(`runtime/${entry.path}\0`);
		hash.update(readFileSync(join(runtimeDirectory, entry.path)));
	}
	const actual = hash.digest('hex');
	if (manifest.audacity.sourceTreeSha256 && actual !== manifest.audacity.sourceTreeSha256) {
		throw new Error(`Pinned Audacity Nyquist source-tree mismatch: ${actual}`);
	}
}

function run(command, args, cwd) {
	const result = spawnSync(command, args, {
		cwd,
		env: environment,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
		maxBuffer: 64 * 1024 * 1024,
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(`${command} failed:\n${result.stdout}${result.stderr}`);
	}
}

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}

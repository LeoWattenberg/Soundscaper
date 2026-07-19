#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import {
	copyFileSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wavpackDirectory = join(root, 'src/lib/tools/audio-editor/wavpack');
const nativeDirectory = join(wavpackDirectory, 'native');
const manifest = JSON.parse(readFileSync(join(wavpackDirectory, 'source-manifest.json'), 'utf8'));
const outputArgumentIndex = process.argv.indexOf('--output');
const outputPath = outputArgumentIndex >= 0
	? resolve(root, process.argv[outputArgumentIndex + 1])
	: join(wavpackDirectory, manifest.wasm.path);
const emcc = process.env.EMCC || 'emcc';
const environment = {
	...process.env,
	SOURCE_DATE_EPOCH: manifest.toolchain.sourceDateEpoch,
	TZ: 'UTC',
	LC_ALL: 'C',
};

verifyPinnedInputs();
verifyManifest();
verifyCompiler();

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'soundscaper-wavpack-wasm-'));
try {
	const objects = [];
	const commonArguments = [
		'-std=c11',
		'-O3',
		'-flto',
		'-mno-simd128',
		'-fno-fast-math',
		'-fno-finite-math-only',
		'-fvisibility=hidden',
		'-DNO_TAGS=1',
		'-DNDEBUG=1',
		'-DHAVE___BUILTIN_CLZ=1',
		'-D_POSIX_C_SOURCE=200809L',
		`-I${nativeDirectory}`,
		`-ffile-prefix-map=${root}=.`,
		`-fdebug-prefix-map=${root}=.`,
	];
	for (const source of manifest.compiledSources) {
		const object = join(temporaryDirectory, `${objects.length}.o`);
		run(emcc, [
			...commonArguments,
			'-c',
			join(nativeDirectory, source),
			'-o',
			object,
		]);
		objects.push(object);
	}

	const exportedFunctions = manifest.wasm.requiredExports
		.filter((name) => name.startsWith('scwp_'))
		.map((name) => `_${name}`);
	const temporaryOutput = join(temporaryDirectory, 'wavpack.wasm');
	run(emcc, [
		...objects,
		'-O3',
		'-flto',
		'-mno-simd128',
		'-fno-fast-math',
		'-fno-finite-math-only',
		'--no-entry',
		'-sSTANDALONE_WASM=1',
		'-sFILESYSTEM=0',
		'-sALLOW_MEMORY_GROWTH=1',
		`-sINITIAL_MEMORY=${manifest.wasm.initialMemoryBytes}`,
		`-sMAXIMUM_MEMORY=${manifest.wasm.maximumMemoryBytes}`,
		`-sSTACK_SIZE=${manifest.wasm.stackBytes}`,
		'-sMALLOC=emmalloc',
		'-sASSERTIONS=0',
		'-sSUPPORT_LONGJMP=0',
		'-sDISABLE_EXCEPTION_CATCHING=1',
		'-sERROR_ON_UNDEFINED_SYMBOLS=1',
		`-sEXPORTED_FUNCTIONS=${JSON.stringify(exportedFunctions)}`,
		'-Wl,--strip-all',
		'-o',
		temporaryOutput,
	]);

	const bytes = readFileSync(temporaryOutput);
	const hash = sha256(bytes);
	if (bytes.byteLength > manifest.wasm.maximumBytes) {
		throw new Error(`WavPack WASM is ${bytes.byteLength} bytes; limit is ${manifest.wasm.maximumBytes}.`);
	}
	if (manifest.wasm.sha256 && hash !== manifest.wasm.sha256) {
		throw new Error(`WavPack WASM hash mismatch: expected ${manifest.wasm.sha256}, got ${hash}.`);
	}
	copyFileSync(temporaryOutput, outputPath);
	process.stdout.write(
		`Built ${relative(root, outputPath)} (${statSync(outputPath).size} bytes)\nSHA-256 ${hash}\n`,
	);
	if (!manifest.wasm.sha256) {
		process.stdout.write('Bootstrap build: pin this hash in source-manifest.json, then rebuild.\n');
	}
} finally {
	rmSync(temporaryDirectory, { recursive: true, force: true });
}

function verifyPinnedInputs() {
	for (const source of manifest.sourceFiles) {
		const actual = sha256(readFileSync(join(nativeDirectory, source.path)));
		if (actual !== source.sha256) {
			throw new Error(`Pinned source mismatch for ${source.path}: expected ${source.sha256}, got ${actual}.`);
		}
	}
	for (const extension of manifest.localExtensions) {
		const actual = sha256(readFileSync(join(wavpackDirectory, extension.path)));
		if (actual !== extension.sha256) {
			throw new Error(`Local extension mismatch for ${extension.path}: expected ${extension.sha256}, got ${actual}.`);
		}
	}
	for (const license of manifest.licenseFiles) {
		const actual = sha256(readFileSync(join(wavpackDirectory, license.path)));
		if (actual !== license.sha256) {
			throw new Error(`Pinned notice/license mismatch for ${license.path}: expected ${license.sha256}, got ${actual}.`);
		}
	}
}

function verifyManifest() {
	const { initialMemoryBytes, maximumMemoryBytes, stackBytes } = manifest.wasm;
	if (manifest.wavpack.revision !== '5803634a030e2a11dba602ba057b89cc34486c67'
		|| manifest.wavpack.tag !== '5.9.0') {
		throw new Error('WavPack must remain pinned to 5.9.0 commit 5803634a030e2a11dba602ba057b89cc34486c67.');
	}
	for (const [name, value] of Object.entries({ initialMemoryBytes, maximumMemoryBytes })) {
		if (!Number.isSafeInteger(value) || value <= 0 || value % 65_536 !== 0) {
			throw new Error(`wasm.${name} must be a positive multiple of 65,536 bytes.`);
		}
	}
	if (initialMemoryBytes !== 8 * 1024 * 1024
		|| maximumMemoryBytes !== 128 * 1024 * 1024) {
		throw new Error('WavPack WASM must grow from 8 MiB to at most 128 MiB.');
	}
	if (!Number.isSafeInteger(stackBytes) || stackBytes < 65_536 || stackBytes > 262_144) {
		throw new Error('wasm.stackBytes must be between 64 KiB and 256 KiB.');
	}
}

function verifyCompiler() {
	const result = spawnSync(emcc, ['--version'], {
		cwd: root,
		env: environment,
		encoding: 'utf8',
	});
	if (result.error?.code === 'ENOENT') {
		throw new Error(
			`${emcc} was not found. Use ${manifest.toolchain.dockerImage} or install Emscripten ${manifest.toolchain.emscriptenVersion}.`,
		);
	}
	if (result.status !== 0) {
		throw new Error(`${emcc} --version failed:\n${result.stderr || result.stdout}`);
	}
	const banner = `${result.stdout}\n${result.stderr}`;
	if (!banner.includes(manifest.toolchain.emscriptenVersion)
		&& process.env.WAVPACK_ALLOW_TOOLCHAIN_MISMATCH !== '1') {
		throw new Error(
			`Expected Emscripten ${manifest.toolchain.emscriptenVersion}. Set WAVPACK_ALLOW_TOOLCHAIN_MISMATCH=1 only for local experiments.`,
		);
	}
}

function run(command, args) {
	const result = spawnSync(command, args, {
		cwd: root,
		env: environment,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(' ')} failed:\n${result.stdout}${result.stderr}`);
	}
}

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}

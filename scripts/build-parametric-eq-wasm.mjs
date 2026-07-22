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
const eqDirectory = join(root, 'src/common/editor/parametric-eq');
const nativeDirectory = join(eqDirectory, 'native');
const manifest = JSON.parse(readFileSync(join(eqDirectory, 'source-manifest.json'), 'utf8'));
const outputArgumentIndex = process.argv.indexOf('--output');
const outputPath = outputArgumentIndex >= 0
	? resolve(root, process.argv[outputArgumentIndex + 1])
	: join(eqDirectory, manifest.wasm.path);
const emxx = process.env.EMXX || 'em++';
const environment = {
	...process.env,
	SOURCE_DATE_EPOCH: manifest.toolchain.sourceDateEpoch,
	TZ: 'UTC',
	LC_ALL: 'C',
};

verifyPinnedInputs();
verifyMemoryBudget();
verifyCompiler();

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'soundscaper-parametric-eq-wasm-'));
try {
	const objectPath = join(temporaryDirectory, 'parametric_eq_wasm.o');
	const commonArguments = [
		'-std=c++17',
		'-O3',
		'-flto',
		'-mno-simd128',
		'-fno-exceptions',
		'-fno-rtti',
		'-fno-fast-math',
		'-fno-finite-math-only',
		'-ffp-contract=off',
		'-fvisibility=hidden',
		'-DNDEBUG=1',
		`-I${nativeDirectory}`,
		`-ffile-prefix-map=${root}=.`,
		`-fdebug-prefix-map=${root}=.`,
	];
	run(emxx, [
		...commonArguments,
		'-c',
		join(nativeDirectory, manifest.compiledSources[0]),
		'-o',
		objectPath,
	]);

	const exportedFunctions = manifest.wasm.requiredExports
		.filter((name) => name.startsWith('peq_'))
		.map((name) => `_${name}`);
	const temporaryOutput = join(temporaryDirectory, 'parametric-eq.wasm');
	run(emxx, [
		objectPath,
		'-O3',
		'-flto',
		'-mno-simd128',
		'-fno-fast-math',
		'-fno-finite-math-only',
		'-ffp-contract=off',
		`-ffile-prefix-map=${root}=.`,
		`-fdebug-prefix-map=${root}=.`,
		'--no-entry',
		'-sSTANDALONE_WASM=1',
		'-sFILESYSTEM=0',
		'-sALLOW_MEMORY_GROWTH=0',
		`-sINITIAL_MEMORY=${manifest.wasm.initialMemoryBytes}`,
		`-sMAXIMUM_MEMORY=${manifest.wasm.maximumMemoryBytes}`,
		`-sSTACK_SIZE=${manifest.wasm.stackBytes}`,
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
		throw new Error(`Parametric EQ WASM is ${bytes.byteLength} bytes; limit is ${manifest.wasm.maximumBytes}.`);
	}
	if (manifest.wasm.sha256 && hash !== manifest.wasm.sha256) {
		throw new Error(`Parametric EQ WASM hash mismatch: expected ${manifest.wasm.sha256}, got ${hash}.`);
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
		const actual = sha256(readFileSync(join(eqDirectory, extension.path)));
		if (actual !== extension.sha256) {
			throw new Error(`Local extension mismatch for ${extension.path}: expected ${extension.sha256}, got ${actual}.`);
		}
	}
	for (const license of manifest.licenseFiles) {
		const actual = sha256(readFileSync(join(eqDirectory, license.path)));
		if (actual !== license.sha256) {
			throw new Error(`Pinned notice/license mismatch for ${license.path}: expected ${license.sha256}, got ${actual}.`);
		}
	}
}

function verifyMemoryBudget() {
	const { initialMemoryBytes, maximumMemoryBytes, stackBytes } = manifest.wasm;
	for (const [name, value] of Object.entries({ initialMemoryBytes, maximumMemoryBytes })) {
		if (!Number.isSafeInteger(value) || value <= 0 || value % 65_536 !== 0) {
			throw new Error(`wasm.${name} must be a positive multiple of 65,536 bytes.`);
		}
	}
	if (initialMemoryBytes !== 1_048_576 || maximumMemoryBytes !== 1_048_576) {
		throw new Error('Parametric EQ WASM must use exactly 1 MiB of fixed, non-growing memory.');
	}
	if (!Number.isSafeInteger(stackBytes) || stackBytes < 16_384 || stackBytes > 131_072) {
		throw new Error('wasm.stackBytes must be between 16 KiB and 128 KiB.');
	}
}

function verifyCompiler() {
	const result = spawnSync(emxx, ['--version'], {
		cwd: root,
		env: environment,
		encoding: 'utf8',
	});
	if (result.error?.code === 'ENOENT') {
		throw new Error(
			`${emxx} was not found. Use ${manifest.toolchain.dockerImage} or install Emscripten ${manifest.toolchain.emscriptenVersion}.`,
		);
	}
	if (result.status !== 0) {
		throw new Error(`${emxx} --version failed:\n${result.stderr || result.stdout}`);
	}
	const banner = `${result.stdout}\n${result.stderr}`;
	if (!banner.includes(manifest.toolchain.emscriptenVersion)
		&& process.env.PARAMETRIC_EQ_ALLOW_TOOLCHAIN_MISMATCH !== '1') {
		throw new Error(
			`Expected Emscripten ${manifest.toolchain.emscriptenVersion}. Set PARAMETRIC_EQ_ALLOW_TOOLCHAIN_MISMATCH=1 only for local experiments.`,
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

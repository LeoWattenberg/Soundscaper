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
const staffpadDirectory = join(root, 'src/lib/tools/audio-editor/staffpad');
const nativeDirectory = join(staffpadDirectory, 'native');
const manifest = JSON.parse(readFileSync(join(staffpadDirectory, 'source-manifest.json'), 'utf8'));
const outputArgumentIndex = process.argv.indexOf('--output');
const outputPath = outputArgumentIndex >= 0
	? resolve(root, process.argv[outputArgumentIndex + 1])
	: join(staffpadDirectory, manifest.wasm.path);
const emcc = process.env.EMCC || 'emcc';
const emxx = process.env.EMXX || 'em++';
const maximumStaffPadMemoryBytes = 64 * 1024 * 1024;
const environment = {
	...process.env,
	SOURCE_DATE_EPOCH: manifest.toolchain.sourceDateEpoch,
	TZ: 'UTC',
	LC_ALL: 'C',
};

verifyPinnedSources();
verifyMemoryBudget();
verifyCompiler(emcc, manifest.toolchain.emscriptenVersion);
verifyCompiler(emxx, manifest.toolchain.emscriptenVersion);

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'kw-staffpad-wasm-'));
try {
	const commonDefinitions = [
		'-DPFFFT_SIMD_DISABLE=1',
		'-DSTAFFPAD_SCALAR_ONLY=1',
		'-DNDEBUG=1',
		`-I${nativeDirectory}`,
		`-I${join(nativeDirectory, 'pffft')}`,
		'-O3',
		'-flto',
		'-mno-simd128',
		'-ffp-contract=off',
		`-ffile-prefix-map=${root}=.`,
		`-fdebug-prefix-map=${root}=.`,
	];
	const objects = [];
	for (const source of manifest.compiledSources) {
		const input = join(nativeDirectory, source);
		const object = join(temporaryDirectory, `${objects.length}.o`);
		const isC = source.endsWith('.c');
		run(isC ? emcc : emxx, [
			...(isC ? ['-std=c11'] : ['-std=c++17', '-fno-exceptions', '-fno-rtti']),
			...commonDefinitions,
			'-c', input,
			'-o', object,
		]);
		objects.push(object);
	}

	const temporaryOutput = join(temporaryDirectory, 'staffpad.wasm');
	const exportedFunctions = manifest.wasm.requiredExports
		.filter((name) => name.startsWith('sp_'))
		.map((name) => `_${name}`);
	run(emxx, [
		...objects,
		'-O3',
		'-flto',
		'-mno-simd128',
		'--no-entry',
		'-sSTANDALONE_WASM=1',
		'-sFILESYSTEM=0',
		'-sALLOW_MEMORY_GROWTH=1',
		`-sINITIAL_MEMORY=${manifest.wasm.initialMemoryBytes}`,
		`-sMAXIMUM_MEMORY=${manifest.wasm.maximumMemoryBytes}`,
		'-sMALLOC=emmalloc',
		'-sASSERTIONS=0',
		'-sSUPPORT_LONGJMP=0',
		'-sDISABLE_EXCEPTION_CATCHING=1',
		'-sERROR_ON_UNDEFINED_SYMBOLS=1',
		`-sEXPORTED_FUNCTIONS=${JSON.stringify(exportedFunctions)}`,
		'-Wl,--strip-all',
		'-o', temporaryOutput,
	]);

	const bytes = readFileSync(temporaryOutput);
	const hash = sha256(bytes);
	if (bytes.byteLength > manifest.wasm.maximumBytes) {
		throw new Error(`StaffPad WASM is ${bytes.byteLength} bytes; limit is ${manifest.wasm.maximumBytes}.`);
	}
	if (manifest.wasm.sha256 && hash !== manifest.wasm.sha256) {
		throw new Error(`StaffPad WASM hash mismatch: expected ${manifest.wasm.sha256}, got ${hash}.`);
	}
	copyFileSync(temporaryOutput, outputPath);
	process.stdout.write(`Built ${relative(root, outputPath)} (${statSync(outputPath).size} bytes)\nSHA-256 ${hash}\n`);
	if (!manifest.wasm.sha256) {
		process.stdout.write('Bootstrap build: record this hash in source-manifest.json, then rebuild to verify reproducibility.\n');
	}
} finally {
	rmSync(temporaryDirectory, { recursive: true, force: true });
}

function verifyPinnedSources() {
	for (const source of manifest.sourceFiles) {
		const actual = sha256(readFileSync(join(nativeDirectory, source.path)));
		if (actual !== source.sha256) {
			throw new Error(`Pinned source mismatch for ${source.path}: expected ${source.sha256}, got ${actual}.`);
		}
	}
	for (const license of manifest.licenseFiles || []) {
		const actual = sha256(readFileSync(join(staffpadDirectory, license.path)));
		if (actual !== license.sha256) {
			throw new Error(`Pinned license mismatch for ${license.path}: expected ${license.sha256}, got ${actual}.`);
		}
	}
}

function verifyMemoryBudget() {
	const { initialMemoryBytes, maximumMemoryBytes } = manifest.wasm;
	for (const [name, value] of Object.entries({ initialMemoryBytes, maximumMemoryBytes })) {
		if (!Number.isSafeInteger(value) || value <= 0 || value % 65_536 !== 0) {
			throw new Error(`wasm.${name} must be a positive multiple of the WebAssembly page size (65536 bytes).`);
		}
	}
	if (initialMemoryBytes > maximumMemoryBytes) {
		throw new Error('wasm.initialMemoryBytes cannot exceed wasm.maximumMemoryBytes.');
	}
	if (maximumMemoryBytes !== maximumStaffPadMemoryBytes) {
		throw new Error(`StaffPad WASM must have a 64 MiB maximum linear-memory budget (${maximumStaffPadMemoryBytes} bytes).`);
	}
}

function verifyCompiler(command, version) {
	const result = spawnSync(command, ['--version'], { cwd: root, env: environment, encoding: 'utf8' });
	if (result.error?.code === 'ENOENT') {
		throw new Error(`${command} was not found. Use ${manifest.toolchain.dockerImage} or install Emscripten ${version}.`);
	}
	if (result.status !== 0) throw new Error(`${command} --version failed:\n${result.stderr || result.stdout}`);
	const banner = `${result.stdout}\n${result.stderr}`;
	if (!banner.includes(version) && process.env.STAFFPAD_ALLOW_TOOLCHAIN_MISMATCH !== '1') {
		throw new Error(`${command} is not pinned Emscripten ${version}. Set STAFFPAD_ALLOW_TOOLCHAIN_MISMATCH=1 only for local experiments.`);
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

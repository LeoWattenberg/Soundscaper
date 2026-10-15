#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { readStrictDefinedMemoryLimits } from './lib/wasm-binary-inspection.mjs';
import { assertLibRawRecoveryProfileV2 } from './lib/lightscaper-libraw-recovery-profile.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'config/lightscaper-libraw-recovery-runtime-manifest.json'), 'utf8'));
const arguments_ = parseArguments(process.argv.slice(2));
const bootstrap = arguments_.has('--bootstrap');
const archivePath = resolve(root, arguments_.get('--source-archive') ?? manifest.upstream.sourceArchive.path);
const outputPath = resolve(root, arguments_.get('--output') ?? manifest.runtime.path);
const bridgePath = resolve(root, manifest.bridge.path);
const emxx = process.env.EMXX || 'em++';
const environment = {
	...process.env, SOURCE_DATE_EPOCH: String(manifest.toolchain.sourceDateEpoch), TZ: 'UTC', LC_ALL: 'C',
};

verifyManifest();
verifyPinned(archivePath, manifest.upstream.sourceArchive, 'LibRaw source archive');
verifyPinned(bridgePath, manifest.bridge, 'LibRaw bridge');
for (const file of manifest.licenseFiles) verifyPinned(resolve(root, file.path), file, file.path);
verifyCompiler();

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'lightscaper-libraw-wasm-'));
try {
	run('tar', ['-xzf', archivePath, '-C', temporaryDirectory, '--no-same-owner', '--no-same-permissions']);
	const upstream = join(temporaryDirectory, `LibRaw-${manifest.upstream.version}`);
	const sources = readSources(upstream);
	const temporaryOutput = join(temporaryDirectory, 'libraw-recovery.wasm');
	const commonFlags = [
		'-std=c++11', '-O3', '-flto', '-mno-simd128', '-ffp-contract=off', '-fno-fast-math',
		'-fno-finite-math-only', '-fvisibility=hidden', '-fwasm-exceptions', '-DNDEBUG=1',
		'-DLIBRAW_NOTHREADS=1', '-DLIBRAW_NO_IOSTREAMS_DATASTREAM=', '-DLIBRAW_MAX_THUMBNAIL_MB=16',
		'-UUSE_JPEG', '-UUSE_ZLIB', '-UUSE_LCMS', '-UUSE_LCMS2', '-UUSE_RAWSPEED', '-UUSE_RAWSPEED3',
		'-UUSE_DNGSDK', '-UUSE_X3FTOOLS', '-U_OPENMP',
		`-ffile-prefix-map=${upstream}=LibRaw-${manifest.upstream.version}`,
		`-fdebug-prefix-map=${upstream}=LibRaw-${manifest.upstream.version}`,
		`-ffile-prefix-map=${temporaryDirectory}=libraw-build`, `-fdebug-prefix-map=${temporaryDirectory}=libraw-build`,
		`-ffile-prefix-map=${root}=.`, `-fdebug-prefix-map=${root}=.`,
	];
	const exportedFunctions = manifest.wasm.requiredExports
		.filter((name) => name.startsWith('raw_')).map((name) => `_${name}`);
	run(emxx, [
		...sources.map((source) => join(upstream, source)), bridgePath, `-I${upstream}`, ...commonFlags,
		'--no-entry', '-sSTANDALONE_WASM=1', '-sFILESYSTEM=0', '-sALLOW_MEMORY_GROWTH=1',
		`-sINITIAL_MEMORY=${String(manifest.runtime.initialMemoryBytes)}`,
		`-sMAXIMUM_MEMORY=${String(manifest.runtime.maximumMemoryBytes)}`,
		`-sSTACK_SIZE=${String(manifest.wasm.stackBytes)}`, '-sMALLOC=emmalloc', '-sASSERTIONS=0',
		'-sSUPPORT_LONGJMP=0', '-sERROR_ON_UNDEFINED_SYMBOLS=1',
		`-sEXPORTED_FUNCTIONS=${JSON.stringify(exportedFunctions)}`, '-Wl,--strip-all', '-o', temporaryOutput,
	]);
	const bytes = readFileSync(temporaryOutput);
	await auditArtifact(bytes, temporaryDirectory);
	mkdirSync(dirname(outputPath), { recursive: true });
	copyFileSync(temporaryOutput, outputPath);
	process.stdout.write(`Built ${relative(root, outputPath)} (${String(bytes.byteLength)} bytes)\n`
		+ `SHA-256 ${sha256(bytes)}\nLibRaw upstream inventory ${String(sources.length)} translation units, `
		+ `SHA-256 ${sha256(`${sources.join('\n')}\n`)}\n`);
	if (!manifest.runtime.sha256) process.stdout.write('Bootstrap build: pin the runtime digest and size, then rebuild.\n');
} finally {
	rmSync(temporaryDirectory, { recursive: true, force: true });
}

function parseArguments(values) {
	const result = new Map();
	for (let index = 0; index < values.length; index += 1) {
		const key = values[index];
		if (key === '--bootstrap' && !result.has(key)) { result.set(key, true); continue; }
		if (!['--source-archive', '--output'].includes(key) || result.has(key)
			|| !values[index + 1] || values[index + 1].startsWith('--')) {
			throw new Error('Usage: node scripts/build-lightscaper-libraw-recovery-wasm.mjs [--source-archive PATH] [--output PATH] [--bootstrap]');
		}
		result.set(key, values[++index]);
	}
	return result;
}

function verifyManifest() {
	assertLibRawRecoveryProfileV2(manifest, { bootstrap });
	if (manifest.schemaVersion !== 2 || manifest.profileVersion !== 1 || manifest.upstream.version !== '0.22.2'
		|| manifest.upstream.sourceArchive.sha256 !== 'de86b035655accff8d4010f1a221fdf50d353cb7b1422ba26f14a0db92612cfa'
		|| manifest.upstream.sourceArchive.byteLength !== 1682962
		|| manifest.toolchain.emscriptenVersion !== '3.1.64'
		|| manifest.toolchain.dockerImage !== 'emscripten/emsdk:3.1.64'
		|| manifest.toolchain.dockerDigest !== 'sha256:8847dad4171ebc8a53d9ae5cda86a2546ef5b2e68834c14dc1ba2b2962e125cc'
		|| String(manifest.toolchain.sourceDateEpoch) !== '1719792000') {
		throw new Error('LibRaw source and compiler must remain pinned to the reviewed 0.22.2 / Emscripten 3.1.64 closure.');
	}
	if (manifest.runtime.initialMemoryBytes !== 32 * 1024 * 1024
		|| manifest.runtime.maximumMemoryBytes !== 512 * 1024 * 1024
		|| manifest.runtime.maximumBytes !== 8 * 1024 * 1024
		|| manifest.wasm?.stackBytes !== 1024 * 1024
		|| !Array.isArray(manifest.wasm.requiredExports) || !Array.isArray(manifest.wasm.allowedImports)
		|| JSON.stringify(Object.entries(manifest.wasm.auxiliaryExports ?? {}).sort())
			!== JSON.stringify([['__indirect_function_table', 'table'], ['__trap', 'function']])) {
		throw new Error('LibRaw memory, artifact or ABI admission bounds changed.');
	}
	if (bootstrap) {
		if (manifest.runtime.sha256 !== '' || manifest.wasm.allowedImports.length !== 0 || !arguments_.has('--output')) {
			throw new Error('Bootstrap requires an unpublished empty runtime digest/import inventory and an explicit inspection --output path.');
		}
	} else if (!/^[a-f0-9]{64}$/.test(manifest.runtime.sha256)
		|| !Number.isSafeInteger(manifest.runtime.byteLength) || manifest.runtime.byteLength <= 0) {
		throw new Error('A normal build requires the reviewed runtime SHA-256 and exact byte length; only an explicit --bootstrap can inspect an unpublished build.');
	}
}

function verifyPinned(path, pin, label) {
	if (!/^[a-f0-9]{64}$/.test(pin.sha256)) throw new Error(`${label} needs a reviewed SHA-256 pin before building.`);
	if (pin.byteLength !== undefined && statSync(path).size !== pin.byteLength) throw new Error(`${label} byte length changed.`);
	if (sha256(readFileSync(path)) !== pin.sha256) throw new Error(`${label} SHA-256 does not match its manifest.`);
}

function verifyCompiler() {
	const output = run(emxx, ['--version']);
	if (!/\(Emscripten[^\n]*\)\s+3\.1\.64(?:\s|$)/.test(output)) {
		throw new Error(`Expected the pinned Emscripten 3.1.64 compiler, got:\n${output}`);
	}
}

function readSources(upstream) {
	const makefile = readFileSync(join(upstream, 'Makefile.am'), 'utf8').replace(/\\\r?\n/g, ' ');
	const assignment = /^lib_libraw_a_SOURCES\s*=([^\r\n]*)$/m.exec(makefile)?.[1];
	const sources = assignment?.trim().split(/\s+/) ?? [];
	if (sources.length < 50 || new Set(sources).size !== sources.length
		|| sources.some((source) => !/^src\/(?:[a-z0-9_]+\/)*[a-z0-9_]+\.cpp$/.test(source))) {
		throw new Error('LibRaw upstream static-library source inventory is malformed.');
	}
	for (const source of sources) if (!statSync(join(upstream, source)).isFile()) throw new Error(`Missing upstream source ${source}.`);
	return sources;
}

async function auditArtifact(bytes, temporaryDirectory) {
	const runtime = manifest.runtime;
	if (bytes.byteLength > runtime.maximumBytes || (runtime.byteLength && bytes.byteLength !== runtime.byteLength)
		|| (runtime.sha256 && sha256(bytes) !== runtime.sha256)) throw new Error('LibRaw WASM artifact differs from its pinned size or digest.');
	if (bytes.includes(Buffer.from(root)) || bytes.includes(Buffer.from(temporaryDirectory))) {
		throw new Error('LibRaw WASM embeds a local build path.');
	}
	const memories = readStrictDefinedMemoryLimits(bytes);
	if (memories.length !== 1 || memories[0].shared || memories[0].memory64
		|| memories[0].minimumPages * 65536 !== runtime.initialMemoryBytes
		|| memories[0].maximumPages * 65536 !== runtime.maximumMemoryBytes) {
		throw new Error('LibRaw WASM defined memory is not the fixed nonshared 32–512 MiB profile.');
	}
	const module = await WebAssembly.compile(bytes);
	const imports = WebAssembly.Module.imports(module);
	const actualImports = imports.map((entry) => `${entry.module}.${entry.name}`).sort();
	const allowedImports = [...manifest.wasm.allowedImports].sort();
	if (imports.some((entry) => entry.kind !== 'function') || (!bootstrap && JSON.stringify(actualImports) !== JSON.stringify(allowedImports))) {
		throw new Error(`LibRaw WASM import inventory changed: ${JSON.stringify(imports)}.`);
	}
	const exports = WebAssembly.Module.exports(module);
	const actualExports = exports.map((entry) => entry.name).sort();
	const expectedExports = [...manifest.wasm.requiredExports, ...Object.keys(manifest.wasm.auxiliaryExports)].sort();
	if (JSON.stringify(actualExports) !== JSON.stringify(expectedExports)
		|| exports.some((entry) => entry.kind !== (manifest.wasm.auxiliaryExports[entry.name]
			?? (entry.name === 'memory' ? 'memory' : 'function')))) {
		throw new Error(`LibRaw WASM export inventory changed: ${JSON.stringify(exports)}.`);
	}
	if (bootstrap) process.stdout.write(`Bootstrap inspection receipt ${JSON.stringify({
		imports, exports, memory: memories[0], byteLength: bytes.byteLength, sha256: sha256(bytes),
	})}\n`);
}

function run(command, values) {
	const result = spawnSync(command, values, {
		cwd: root, env: environment, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024,
	});
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`${command} failed (${String(result.status)}):\n${result.stdout}${result.stderr}`);
	return `${result.stdout}${result.stderr}`;
}

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }

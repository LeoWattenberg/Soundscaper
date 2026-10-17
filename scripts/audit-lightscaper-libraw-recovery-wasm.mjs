#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readStrictDefinedMemoryLimits } from './lib/wasm-binary-inspection.mjs';
import { assertLibRawRecoveryProfileV2, RECOVERY_ABI_EXPORTS_V2, RECOVERY_ABI_IMPORTS_V2 } from './lib/lightscaper-libraw-recovery-profile.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDigest = 'de86b035655accff8d4010f1a221fdf50d353cb7b1422ba26f14a0db92612cfa';
const compilerDigest = 'sha256:8847dad4171ebc8a53d9ae5cda86a2546ef5b2e68834c14dc1ba2b2962e125cc';
const permittedImports = new Set(RECOVERY_ABI_IMPORTS_V2);
const abiExports = RECOVERY_ABI_EXPORTS_V2;
const licensePaths = ['COMPILER_RT.txt', 'COPYRIGHT', 'EMSCRIPTEN.txt', 'LIBCXX.txt', 'LIBCXXABI.txt',
	'LICENSE.CDDL', 'LICENSE.LGPL', 'MUSL.txt'].map(name => `src/common/editor/raw/licenses/${name}`);

/** Audit the complete checked-in publication closure without instantiating the
 * decoder or granting a module any filesystem, network or worker authority. */
export async function auditLightscaperLibRawRecoveryWasmV2({ runtimePath } = {}) {
	const findings = [];
	let manifest;
	try { manifest = JSON.parse(readFileSync(join(root, 'config/lightscaper-libraw-recovery-runtime-manifest.json'), 'utf8')); }
	catch (error) { return Object.freeze([`Cannot read the LibRaw runtime manifest: ${error.message}`]); }
	if (!validClosure(manifest, findings)) return Object.freeze(findings);
	checkFile(resolve(root, manifest.upstream.sourceArchive.path), manifest.upstream.sourceArchive, 'LibRaw corresponding source', findings);
	checkFile(resolve(root, manifest.bridge.path), manifest.bridge, 'LibRaw native bridge', findings);
	checkFile(resolve(root, manifest.buildRecipe.path), manifest.buildRecipe, 'LibRaw build recipe', findings);
	for (const license of manifest.licenseFiles) checkFile(resolve(root, license.path), license, license.path, findings);
	const path = runtimePath ? resolve(root, runtimePath) : resolve(root, manifest.runtime.path);
	const bytes = checkFile(path, manifest.runtime, 'LibRaw runtime', findings, manifest.runtime.maximumBytes);
	if (bytes) await auditBinary(bytes, manifest, findings);
	return Object.freeze(findings);
}

function validClosure(manifest, findings) {
	try { assertLibRawRecoveryProfileV2(manifest); } catch (error) { findings.push(error.message); }
	if (manifest.schemaVersion !== 2 || manifest.profileVersion !== 1 || manifest.upstream?.version !== '0.22.2'
		|| manifest.upstream?.sourceArchive?.sha256 !== sourceDigest
		|| manifest.upstream?.sourceArchive?.byteLength !== 1682962
		|| manifest.upstream?.sourceArchive?.path !== 'runtime-assets/libraw/0.22.2/LibRaw-0.22.2.tar.gz'
		|| manifest.upstream?.sourceArchive?.url !== 'https://www.libraw.org/data/LibRaw-0.22.2.tar.gz') {
		findings.push('LibRaw corresponding source is not the reviewed official 0.22.2 archive.');
	}
	if (manifest.toolchain?.emscriptenVersion !== '3.1.64'
		|| manifest.toolchain?.dockerImage !== 'emscripten/emsdk:3.1.64'
		|| manifest.toolchain?.dockerDigest !== compilerDigest
		|| String(manifest.toolchain?.sourceDateEpoch) !== '1719792000') findings.push('LibRaw reproducible compiler closure changed.');
	if (manifest.bridge?.path !== 'src/common/editor/raw/native/libraw_recovery_wasm.cpp'
		|| !validDigest(manifest.bridge?.sha256)) findings.push('LibRaw native bridge is not pinned.');
	if (manifest.buildRecipe?.path !== 'scripts/build-lightscaper-libraw-recovery-wasm.mjs'
		|| !validDigest(manifest.buildRecipe?.sha256)) findings.push('LibRaw build recipe is not pinned.');
	const runtime = manifest.runtime, wasm = manifest.wasm;
	if (runtime?.path !== 'runtime-assets/libraw/0.22.2/recovery-abi2/libraw-recovery.wasm'
		|| runtime?.url !== 'https://assets.soundscaper.org/runtime/libraw/0.22.2/recovery-abi2/libraw-recovery.wasm'
		|| !validDigest(runtime?.sha256) || !Number.isSafeInteger(runtime?.byteLength) || runtime.byteLength < 8
		|| runtime.byteLength > 8 * 1024 * 1024 || runtime.maximumBytes !== 8 * 1024 * 1024
		|| runtime.initialMemoryBytes !== 32 * 1024 * 1024 || runtime.maximumMemoryBytes !== 512 * 1024 * 1024
		|| wasm?.stackBytes !== 1024 * 1024) findings.push('LibRaw runtime publication or memory limits are not pinned.');
	if (!Array.isArray(wasm?.requiredExports) || !Array.isArray(wasm?.allowedImports)
		|| !abiExports.every(name => wasm.requiredExports.includes(name))
		|| new Set(wasm.requiredExports).size !== wasm.requiredExports.length
		|| wasm.requiredExports.some(name => !abiExports.includes(name))
		|| JSON.stringify(Object.entries(wasm.auxiliaryExports ?? {}).sort())
			!== JSON.stringify([['__indirect_function_table', 'table'], ['__trap', 'function']])
		|| new Set(wasm.allowedImports).size !== wasm.allowedImports.length
		|| !sameNames(wasm.allowedImports, [...permittedImports])) findings.push('LibRaw native import/export contract is not the bounded ABI2 closure.');
	if (!Array.isArray(manifest.licenseFiles) || manifest.licenseFiles.length !== 8
		|| new Set(manifest.licenseFiles.map(file => file.path)).size !== 8
		|| !sameNames(manifest.licenseFiles.map(file => file.path), licensePaths)
		|| manifest.licenseFiles.some(file => !validDigest(file.sha256))) {
		findings.push('LibRaw upstream/toolchain license closure is incomplete.');
	}
	return findings.length === 0;
}

function checkFile(path, pin, label, findings, maximumBytes) {
	try {
		const size = statSync(path).size;
		if ((pin.byteLength !== undefined && size !== pin.byteLength) || (maximumBytes !== undefined && size > maximumBytes)) {
			findings.push(`${label} byte length differs from its pin or exceeds its ceiling.`); return null;
		}
		const bytes = readFileSync(path);
		if (!validDigest(pin.sha256) || sha256(bytes) !== pin.sha256) findings.push(`${label} SHA-256 differs from its pin.`);
		return bytes;
	} catch (error) { findings.push(`Cannot read ${label}: ${error.message}`); return null; }
}

async function auditBinary(bytes, manifest, findings) {
	if (bytes.includes(Buffer.from(root)) || /\/tmp\/(?:lightscaper-libraw-wasm-|lsraw-recovery-)/.test(bytes.toString('latin1'))) {
		findings.push('LibRaw runtime embeds a local checkout or temporary build path.');
	}
	try {
		const memories = readStrictDefinedMemoryLimits(bytes);
		if (memories.length !== 1 || memories[0].shared || memories[0].memory64
			|| memories[0].minimumPages * 65536 !== manifest.runtime.initialMemoryBytes
			|| memories[0].maximumPages * 65536 !== manifest.runtime.maximumMemoryBytes) {
			findings.push('LibRaw runtime does not define exactly one bounded nonshared 32–512 MiB memory.');
		}
	} catch (error) { findings.push(`Cannot inspect LibRaw defined memory: ${error.message}`); }
	try {
		const module = await WebAssembly.compile(bytes);
		const imports = WebAssembly.Module.imports(module), exports = WebAssembly.Module.exports(module);
		if (imports.some(entry => entry.kind !== 'function')
			|| !sameNames(imports.map(entry => `${entry.module}.${entry.name}`), manifest.wasm.allowedImports)) {
			findings.push(`LibRaw runtime import inventory differs: ${JSON.stringify(imports)}.`);
		}
		if (!sameNames(exports.map(entry => entry.name), [...manifest.wasm.requiredExports, ...Object.keys(manifest.wasm.auxiliaryExports)])
			|| exports.some(entry => entry.kind !== (manifest.wasm.auxiliaryExports[entry.name]
				?? (entry.name === 'memory' ? 'memory' : 'function')))) {
			findings.push(`LibRaw runtime export inventory differs: ${JSON.stringify(exports)}.`);
		}
	} catch (error) { findings.push(`Cannot compile the pinned LibRaw runtime: ${error.message}`); }
}

function sameNames(left, right) { return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort()); }
function validDigest(value) { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const values = process.argv.slice(2);
	if (values.length && (values.length !== 2 || values[0] !== '--wasm' || !values[1])) {
		throw new Error('Usage: node scripts/audit-lightscaper-libraw-recovery-wasm.mjs [--wasm PATH]');
	}
	const findings = await auditLightscaperLibRawRecoveryWasmV2({ runtimePath: values[1] });
	if (findings.length) {
		for (const finding of findings) process.stderr.write(`${finding}\n`);
		process.exitCode = 1;
	} else process.stdout.write('Lightscaper LibRaw recovery source, bridge, licenses, runtime bytes and native ABI2 audit passed.\n');
}

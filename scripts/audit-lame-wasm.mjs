#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lameDirectory = join(root, 'src/common/editor/lame');
const manifestPath = join(lameDirectory, 'source-manifest.json');
const wasmPageBytes = 65_536;

export async function auditLameWasm() {
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
	const findings = [];
	validateManifest(manifest, findings);
	for (const file of manifest.localFiles || []) {
		try {
			if (sha256(readFileSync(join(lameDirectory, file.path))) !== file.sha256) {
				findings.push(`Local LAME file hash mismatch: ${file.path}`);
			}
		} catch { findings.push(`Missing local LAME file: ${String(file.path)}`); }
	}
	let wasm = null;
	try { wasm = readFileSync(join(lameDirectory, manifest.wasm.path)); }
	catch { findings.push(`Missing LAME artifact: ${String(manifest.wasm?.path)}`); }
	if (wasm) {
		auditArtifact(wasm, manifest, findings);
		await auditModule(wasm, manifest, findings);
	}
	return Object.freeze({
		ok: findings.length === 0,
		findings: Object.freeze(findings),
		version: manifest.lame?.release ?? null,
		archiveSha256: manifest.lame?.archiveSha256 ?? null,
		wasmBytes: wasm?.byteLength ?? null,
		wasmSha256: wasm ? sha256(wasm) : null,
	});
}

function validateManifest(manifest, findings) {
	if (manifest.schemaVersion !== 1 || manifest.lame?.release !== '4.0'
		|| manifest.lame?.license !== 'LGPL-2.0-or-later'
		|| manifest.lame?.archiveSha256 !== '3df5124d5ad3a98312ffd7ba6a9b36230e4f8a3e66d3ce0f425e336c32d216eb') {
		findings.push('LAME source admission is not pinned to the official 4.0 archive.');
	}
	if (manifest.toolchain?.emscriptenVersion !== '3.1.64'
		|| manifest.toolchain?.dockerImage !== 'emscripten/emsdk:3.1.64'
		|| manifest.toolchain?.dockerImageDigest
			!== 'sha256:8847dad4171ebc8a53d9ae5cda86a2546ef5b2e68834c14dc1ba2b2962e125cc') {
		findings.push('LAME toolchain admission changed.');
	}
	if (JSON.stringify(manifest.configureArguments) !== JSON.stringify([
		'--disable-shared', '--enable-static', '--disable-dependency-tracking',
		'--disable-frontend', '--disable-decoder', '--disable-gtktest',
		'--disable-cpml', '--disable-nasm',
	])) findings.push('LAME configure admission changed.');
	if (JSON.stringify(manifest.buildFeatures) !== JSON.stringify({
		decoder: false, files: false, frontend: false, maximumChannels: 2,
		simd: false, threads: false, vbr: true, xingLameGaplessTag: true,
	})) findings.push('LAME public build profile changed.');
	if (manifest.compiledArchiveEvidence?.memberCount !== 20
		|| manifest.compiledArchiveEvidence?.membersSha256
			!== '88941a5528ff5f3baeb2e60a85d671f95674236a9953a115f824ee786916a1df') {
		findings.push('LAME compiled archive membership evidence changed.');
	}
	if (manifest.wasm?.initialMemoryBytes !== 8 * 1024 * 1024
		|| manifest.wasm?.maximumMemoryBytes !== 256 * 1024 * 1024
		|| manifest.wasm?.stackBytes !== 256 * 1024) findings.push('LAME linear-memory limits changed.');
}

function auditArtifact(wasm, manifest, findings) {
	const path = join(lameDirectory, manifest.wasm.path);
	if (statSync(path).size > manifest.wasm.maximumBytes) findings.push('LAME artifact exceeds its byte limit.');
	const hash = sha256(wasm);
	if (!/^[0-9a-f]{64}$/u.test(manifest.wasm.sha256)) findings.push('LAME artifact digest is not pinned.');
	else if (hash !== manifest.wasm.sha256) findings.push(`LAME artifact digest mismatch: ${hash}`);
	if (wasm.includes(Buffer.from(root))) findings.push('LAME artifact embeds the local checkout path.');
	try {
		const memories = readDefinedMemoryLimits(wasm);
		if (memories.length !== 1) findings.push(`Expected one LAME WASM memory, found ${String(memories.length)}.`);
		else {
			const [memory] = memories;
			if (memory.memory64 || memory.shared) findings.push('LAME WASM memory is shared or memory64.');
			if (memory.minimumPages * wasmPageBytes !== manifest.wasm.initialMemoryBytes
				|| memory.maximumPages === null
				|| memory.maximumPages * wasmPageBytes !== manifest.wasm.maximumMemoryBytes) {
				findings.push('LAME WASM memory bounds do not match the manifest.');
			}
		}
	} catch (error) { findings.push(`Could not inspect LAME WASM memory: ${error.message}`); }
}

async function auditModule(wasm, manifest, findings) {
	let module;
	try { module = await WebAssembly.compile(wasm); }
	catch (error) { findings.push(`Invalid LAME WebAssembly: ${error.message}`); return; }
	const allowedImports = new Set(manifest.wasm.allowedFunctionImports);
	const actualImports = [];
	const imports = {};
	for (const descriptor of WebAssembly.Module.imports(module)) {
		const key = `${descriptor.module}.${descriptor.name}`;
		actualImports.push(key);
		if (descriptor.kind !== 'function' || !allowedImports.has(key)) {
			findings.push(`Forbidden LAME WASM import: ${descriptor.kind} ${key}`);
		}
		imports[descriptor.module] ||= {};
		imports[descriptor.module][descriptor.name] = descriptor.name === 'proc_exit'
			? (code) => { throw new Error(`unexpected process exit ${String(code)}`); }
			: () => 8;
	}
	if (JSON.stringify(actualImports.sort()) !== JSON.stringify([...allowedImports].sort())) {
		findings.push('LAME WASM import inventory does not exactly match its manifest.');
	}
	const exports = new Set(WebAssembly.Module.exports(module).map((descriptor) => descriptor.name));
	for (const name of manifest.wasm.requiredExports) {
		if (!exports.has(name) && !exports.has(`_${name}`)) findings.push(`Missing LAME WASM export: ${name}`);
	}
	if (findings.some((finding) => finding.startsWith('Forbidden LAME WASM import:'))) return;
	try {
		const instance = await WebAssembly.instantiate(module, imports);
		const api = instance.exports;
		const exported = (name) => api[name] || api[`_${name}`];
		exported('_initialize')?.();
		if (exported('sclm_abi_version')() !== 2 || exported('sclm_lame_major')() !== 4
			|| exported('sclm_lame_minor')() !== 0 || exported('sclm_maximum_channels')() !== 2
			|| exported('sclm_maximum_frames')() !== 8_388_608
			|| exported('sclm_maximum_rate_mode')() !== 3
			|| exported('sclm_maximum_vbr_quality')() !== 9
			|| exported('sclm_maximum_preset')() !== 3
			|| exported('sclm_initial_memory_bytes')() !== 8 * 1024 * 1024
			|| exported('sclm_maximum_memory_bytes')() !== 256 * 1024 * 1024
			|| api.memory.buffer.byteLength !== 8 * 1024 * 1024) {
			findings.push('LAME WASM ABI limits changed.');
			return;
		}
		verifyCanary(api.memory, exported);
	} catch (error) { findings.push(`LAME WASM ABI canary failed: ${error.message}`); }
}

function verifyCanary(memory, exported) {
	/* Constant 128 kbps, then variable quality 2, then the Standard preset. */
	verifyRateMode(memory, exported, 0, 128, 'Info');
	verifyRateMode(memory, exported, 2, 2, 'Xing');
	verifyRateMode(memory, exported, 3, 2, 'Xing');
}

function verifyRateMode(memory, exported, rateMode, rateValue, expectedTag) {
	const frames = 1_153;
	const inputBytes = frames * Float32Array.BYTES_PER_ELEMENT;
	const inputPointer = allocate(exported, memory, inputBytes);
	const outputCapacity = 64 * 1024;
	const outputPointer = allocate(exported, memory, outputCapacity);
	try {
		const encodedBytes = exported('sclm_encode_float32')(
			inputPointer, frames, 1, 48_000, rateMode, rateValue, outputPointer, outputCapacity,
		);
		if (!Number.isSafeInteger(encodedBytes) || encodedBytes < 512 || encodedBytes > outputCapacity) {
			throw new Error(`rate mode ${String(rateMode)} returned an invalid byte count`);
		}
		const encoded = new Uint8Array(memory.buffer, outputPointer, encodedBytes);
		if (encoded[0] !== 0xff || (encoded[1] & 0xfe) !== 0xfa
			|| !includesAscii(encoded, expectedTag) || !includesAscii(encoded, 'LAME')) {
			throw new Error(`rate mode ${String(rateMode)} returned an unexpected MPEG/Xing/LAME stream`);
		}
	} finally {
		exported('sclm_free')(outputPointer);
		exported('sclm_free')(inputPointer);
	}
}

function includesAscii(bytes, value) {
	const expected = Buffer.from(value);
	for (let offset = 0; offset + expected.byteLength <= bytes.byteLength; offset++) {
		let matches = true;
		for (let index = 0; index < expected.byteLength; index++) {
			if (bytes[offset + index] !== expected[index]) { matches = false; break; }
		}
		if (matches) return true;
	}
	return false;
}

function allocate(exported, memory, bytes) {
	const pointer = exported('sclm_allocate')(bytes);
	if (!Number.isSafeInteger(pointer) || pointer <= 0 || pointer + bytes > memory.buffer.byteLength) {
		throw new Error('allocation failed');
	}
	return pointer;
}

function readDefinedMemoryLimits(wasm) {
	if (wasm.byteLength < 8 || wasm.readUInt32LE(0) !== 0x6d736100 || wasm.readUInt32LE(4) !== 1) {
		throw new Error('invalid WebAssembly header');
	}
	const limits = [];
	let offset = 8;
	while (offset < wasm.byteLength) {
		const sectionId = wasm[offset++];
		const sectionSize = readUnsignedLeb(wasm, offset);
		offset = sectionSize.nextOffset;
		const sectionEnd = offset + sectionSize.value;
		if (sectionEnd > wasm.byteLength) throw new Error('section extends beyond artifact');
		if (sectionId === 5) {
			const count = readUnsignedLeb(wasm, offset);
			offset = count.nextOffset;
			for (let index = 0; index < count.value; index++) {
				const flags = readUnsignedLeb(wasm, offset); offset = flags.nextOffset;
				const minimum = readUnsignedLeb(wasm, offset); offset = minimum.nextOffset;
				let maximumPages = null;
				if (flags.value & 1) {
					const maximum = readUnsignedLeb(wasm, offset); offset = maximum.nextOffset;
					maximumPages = maximum.value;
				}
				limits.push({
					minimumPages: minimum.value, maximumPages,
					shared: Boolean(flags.value & 2), memory64: Boolean(flags.value & 4),
				});
			}
		}
		offset = sectionEnd;
	}
	return limits;
}

function readUnsignedLeb(bytes, start) {
	let value = 0;
	let shift = 0;
	let offset = start;
	while (offset < bytes.byteLength && shift <= 35) {
		const byte = bytes[offset++];
		value += (byte & 0x7f) * 2 ** shift;
		if ((byte & 0x80) === 0) return { value, nextOffset: offset };
		shift += 7;
	}
	throw new Error('invalid unsigned LEB128');
}

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const result = await auditLameWasm();
	if (!result.ok) {
		for (const finding of result.findings) process.stderr.write(`- ${finding}\n`);
		process.exitCode = 1;
	} else process.stdout.write(
		`LAME ${result.version} WASM ${String(result.wasmBytes)} bytes ${result.wasmSha256}\n`,
	);
}

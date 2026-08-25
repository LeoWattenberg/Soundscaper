#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const flacDirectory = join(root, 'src/common/editor/flac');
const manifestPath = join(flacDirectory, 'source-manifest.json');
const wasmPageBytes = 65_536;
const expectedSources = Object.freeze([
	'src/libFLAC/bitmath.c', 'src/libFLAC/bitreader.c', 'src/libFLAC/bitwriter.c',
	'src/libFLAC/cpu.c', 'src/libFLAC/crc.c', 'src/libFLAC/fixed.c',
	'src/libFLAC/float.c', 'src/libFLAC/format.c', 'src/libFLAC/lpc.c',
	'src/libFLAC/md5.c', 'src/libFLAC/memory.c', 'src/libFLAC/stream_decoder.c',
	'src/libFLAC/stream_encoder.c', 'src/libFLAC/stream_encoder_framing.c',
	'src/libFLAC/window.c',
]);

export async function auditFlacWasm() {
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
	const findings = [];
	validateManifest(manifest, findings);
	for (const file of manifest.localFiles || []) {
		try {
			const actual = sha256(readFileSync(join(flacDirectory, file.path)));
			if (actual !== file.sha256) findings.push(`Local FLAC file hash mismatch: ${file.path}`);
		} catch {
			findings.push(`Missing local FLAC file: ${String(file.path)}`);
		}
	}
	let wasm = null;
	try { wasm = readFileSync(join(flacDirectory, manifest.wasm.path)); }
	catch { findings.push(`Missing FLAC artifact: ${String(manifest.wasm?.path)}`); }
	if (wasm) {
		auditArtifact(wasm, manifest, findings);
		await auditModule(wasm, manifest, findings);
	}
	return Object.freeze({
		ok: findings.length === 0,
		findings: Object.freeze(findings),
		version: manifest.flac?.tag ?? null,
		revision: manifest.flac?.revision ?? null,
		archiveSha256: manifest.flac?.archiveSha256 ?? null,
		wasmBytes: wasm?.byteLength ?? null,
		wasmSha256: wasm ? sha256(wasm) : null,
	});
}

function validateManifest(manifest, findings) {
	if (manifest.schemaVersion !== 1 || manifest.flac?.tag !== '1.5.0'
		|| manifest.flac?.revision !== '1507800de4b70e21be71f38caa0d9079d0bc6e45'
		|| manifest.flac?.license !== 'BSD-3-Clause'
		|| manifest.flac?.archiveUrl !== 'https://downloads.xiph.org/releases/flac/flac-1.5.0.tar.xz'
		|| manifest.flac?.archiveRedirectUrl !== 'https://ftp.osuosl.org/pub/xiph/releases/flac/flac-1.5.0.tar.xz'
		|| manifest.flac?.archiveSha256 !== 'f2c1c76592a82ffff8413ba3c4a1299b6c7ab06c734dee03fd88630485c2b920') {
		findings.push('FLAC source admission is not pinned to official libFLAC 1.5.0.');
	}
	if (manifest.toolchain?.emscriptenVersion !== '3.1.64'
		|| manifest.toolchain?.dockerImage !== 'emscripten/emsdk:3.1.64'
		|| manifest.toolchain?.dockerImageDigest !== 'sha256:8847dad4171ebc8a53d9ae5cda86a2546ef5b2e68834c14dc1ba2b2962e125cc') {
		findings.push('FLAC toolchain admission changed.');
	}
	if (JSON.stringify(manifest.compiledSources) !== JSON.stringify(expectedSources)) {
		findings.push('FLAC compiled source allowlist changed.');
	}
	if (manifest.buildFeatures?.files !== false || manifest.buildFeatures?.metadataMutation !== false
		|| manifest.buildFeatures?.ogg !== false || manifest.buildFeatures?.simd !== false
		|| manifest.buildFeatures?.threads !== false) {
		findings.push('FLAC build features must remain narrow and memory-only.');
	}
	if (manifest.wasm?.initialMemoryBytes !== 8 * 1024 * 1024
		|| manifest.wasm?.maximumMemoryBytes !== 256 * 1024 * 1024
		|| manifest.wasm?.stackBytes !== 256 * 1024) {
		findings.push('FLAC linear-memory limits changed.');
	}
}

function auditArtifact(wasm, manifest, findings) {
	const path = join(flacDirectory, manifest.wasm.path);
	if (statSync(path).size > manifest.wasm.maximumBytes) findings.push('FLAC artifact exceeds its byte limit.');
	const hash = sha256(wasm);
	if (!/^[0-9a-f]{64}$/u.test(manifest.wasm.sha256)) findings.push('FLAC artifact digest is not pinned.');
	else if (hash !== manifest.wasm.sha256) findings.push(`FLAC artifact digest mismatch: ${hash}`);
	if (wasm.includes(Buffer.from(root))) findings.push('FLAC artifact embeds the local checkout path.');
	try {
		const memories = readDefinedMemoryLimits(wasm);
		if (memories.length !== 1) findings.push(`Expected one FLAC WASM memory, found ${String(memories.length)}.`);
		else {
			const [memory] = memories;
			if (memory.memory64 || memory.shared) findings.push('FLAC WASM memory is shared or memory64.');
			if (memory.minimumPages * wasmPageBytes !== manifest.wasm.initialMemoryBytes
				|| memory.maximumPages === null
				|| memory.maximumPages * wasmPageBytes !== manifest.wasm.maximumMemoryBytes) {
				findings.push('FLAC WASM memory bounds do not match the manifest.');
			}
		}
	} catch (error) { findings.push(`Could not inspect FLAC WASM memory: ${error.message}`); }
}

async function auditModule(wasm, manifest, findings) {
	let module;
	try { module = await WebAssembly.compile(wasm); }
	catch (error) { findings.push(`Invalid FLAC WebAssembly: ${error.message}`); return; }
	const allowedImports = new Set(manifest.wasm.allowedFunctionImports);
	const imports = {};
	for (const descriptor of WebAssembly.Module.imports(module)) {
		const key = `${descriptor.module}.${descriptor.name}`;
		if (descriptor.kind !== 'function' || !allowedImports.has(key)) {
			findings.push(`Forbidden FLAC WASM import: ${descriptor.kind} ${key}`);
		}
		imports[descriptor.module] ||= {};
		imports[descriptor.module][descriptor.name] = () => 0;
	}
	const exports = new Set(WebAssembly.Module.exports(module).map((descriptor) => descriptor.name));
	for (const name of manifest.wasm.requiredExports) {
		if (!exports.has(name) && !exports.has(`_${name}`)) findings.push(`Missing FLAC WASM export: ${name}`);
	}
	if (findings.some((finding) => finding.startsWith('Forbidden FLAC WASM import:'))) return;
	try {
		const instance = await WebAssembly.instantiate(module, imports);
		const api = instance.exports;
		const exported = (name) => api[name] || api[`_${name}`];
		exported('_initialize')?.();
		if (exported('scfl_abi_version')() !== 1 || exported('scfl_maximum_channels')() !== 8
			|| exported('scfl_maximum_frames')() !== 33_554_432
			|| exported('scfl_initial_memory_bytes')() !== 8 * 1024 * 1024
			|| exported('scfl_maximum_memory_bytes')() !== 256 * 1024 * 1024
			|| api.memory.buffer.byteLength !== 8 * 1024 * 1024) {
			findings.push('FLAC WASM ABI limits changed.');
			return;
		}
		verifyCanary(api.memory, exported);
	} catch (error) { findings.push(`FLAC WASM ABI canary failed: ${error.message}`); }
}

function verifyCanary(memory, exported) {
	const frames = 128;
	const channels = 2;
	const input = new Float32Array(frames * channels);
	for (let frame = 0; frame < frames; frame++) {
		input[frame * channels] = Math.sin(frame / 9) * 0.5;
		input[frame * channels + 1] = Math.cos(frame / 13) * 0.25;
	}
	const inputBytes = new Uint8Array(input.buffer);
	const inputPointer = allocate(exported, memory, inputBytes.byteLength);
	const encodedCapacity = 64 * 1024;
	const encodedPointer = allocate(exported, memory, encodedCapacity);
	let decodePointer = 0;
	let outputPointer = 0;
	try {
		new Uint8Array(memory.buffer, inputPointer, inputBytes.byteLength).set(inputBytes);
		const encodedBytes = exported('scfl_encode_float32')(
			inputPointer, frames, channels, 48_000, 5, encodedPointer, encodedCapacity,
		);
		if (!Number.isSafeInteger(encodedBytes) || encodedBytes < 42 || encodedBytes > encodedCapacity) {
			throw new Error('encoder returned an invalid byte count');
		}
		const encoded = Uint8Array.from(new Uint8Array(memory.buffer, encodedPointer, encodedBytes));
		if (String.fromCharCode(...encoded.subarray(0, 4)) !== 'fLaC') throw new Error('encoder omitted FLAC marker');
		decodePointer = allocate(exported, memory, encoded.byteLength);
		outputPointer = allocate(exported, memory, inputBytes.byteLength);
		new Uint8Array(memory.buffer, decodePointer, encoded.byteLength).set(encoded);
		const decodedBytes = exported('scfl_decode_float32')(
			decodePointer, encoded.byteLength, frames, channels, 48_000,
			outputPointer, inputBytes.byteLength,
		);
		if (decodedBytes !== inputBytes.byteLength) throw new Error('decoder returned an invalid byte count');
		const decoded = new Float32Array(memory.buffer, outputPointer, input.length);
		for (let index = 0; index < input.length; index++) {
			if (Math.abs(decoded[index] - input[index]) > 2 ** -22) throw new Error('round-trip mismatch');
		}
	} finally {
		if (outputPointer) exported('scfl_free')(outputPointer);
		if (decodePointer) exported('scfl_free')(decodePointer);
		exported('scfl_free')(encodedPointer);
		exported('scfl_free')(inputPointer);
	}
}

function allocate(exported, memory, bytes) {
	const pointer = exported('scfl_allocate')(bytes);
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
				const flags = readUnsignedLeb(wasm, offset);
				offset = flags.nextOffset;
				const minimum = readUnsignedLeb(wasm, offset);
				offset = minimum.nextOffset;
				let maximumPages = null;
				if (flags.value & 0x01) {
					const maximum = readUnsignedLeb(wasm, offset);
					offset = maximum.nextOffset;
					maximumPages = maximum.value;
				}
				limits.push({
					minimumPages: minimum.value, maximumPages,
					shared: Boolean(flags.value & 0x02), memory64: Boolean(flags.value & 0x04),
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
	const result = await auditFlacWasm();
	if (!result.ok) {
		process.stderr.write(`${result.findings.join('\n')}\n`);
		process.exitCode = 1;
	} else {
		process.stdout.write(`FLAC WASM audit passed (${String(result.wasmBytes)} bytes, ${result.wasmSha256}).\n`);
	}
}

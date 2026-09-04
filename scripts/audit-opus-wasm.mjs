#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const opusDirectory = join(root, 'src/common/editor/opus');
const manifestPath = join(opusDirectory, 'source-manifest.json');
const wasmPageBytes = 65_536;

export async function auditOpusWasm() {
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
	const findings = [];
	validateManifest(manifest, findings);
	for (const file of manifest.localFiles || []) {
		try {
			if (sha256(readFileSync(join(opusDirectory, file.path))) !== file.sha256) {
				findings.push(`Local Ogg Opus file hash mismatch: ${file.path}`);
			}
		} catch { findings.push(`Missing local Ogg Opus file: ${String(file.path)}`); }
	}
	let wasm = null;
	try { wasm = readFileSync(join(opusDirectory, manifest.wasm.path)); }
	catch { findings.push(`Missing Ogg Opus artifact: ${String(manifest.wasm?.path)}`); }
	if (wasm) {
		auditArtifact(wasm, manifest, findings);
		await auditModule(wasm, manifest, findings);
	}
	return Object.freeze({
		ok: findings.length === 0,
		findings: Object.freeze(findings),
		opusVersion: manifest.opus?.tag?.replace(/^v/u, '') ?? null,
		oggVersion: manifest.ogg?.tag?.replace(/^v/u, '') ?? null,
		opusRevision: manifest.opus?.revision ?? null,
		oggRevision: manifest.ogg?.revision ?? null,
		opusArchiveSha256: manifest.opus?.archiveSha256 ?? null,
		oggArchiveSha256: manifest.ogg?.archiveSha256 ?? null,
		wasmBytes: wasm?.byteLength ?? null,
		wasmSha256: wasm ? sha256(wasm) : null,
	});
}

function validateManifest(manifest, findings) {
	if (manifest.schemaVersion !== 1 || manifest.opus?.tag !== 'v1.6.1'
		|| manifest.opus?.revision !== '22244de5a79bd1d6d623c32e72bf1954b56235be'
		|| manifest.opus?.license !== 'BSD-3-Clause'
		|| manifest.opus?.archiveSha256 !== '6ffcb593207be92584df15b32466ed64bbec99109f007c82205f0194572411a1') {
		findings.push('libopus source admission is not pinned to official 1.6.1.');
	}
	if (manifest.ogg?.tag !== 'v1.3.6'
		|| manifest.ogg?.revision !== 'be05b13e98b048f0b5a0f5fa8ce514d56db5f822'
		|| manifest.ogg?.license !== 'BSD-3-Clause'
		|| manifest.ogg?.archiveSha256 !== '5c8253428e181840cd20d41f3ca16557a9cc04bad4a3d04cce84808677fa1061') {
		findings.push('libogg source admission is not pinned to official 1.3.6.');
	}
	if (manifest.toolchain?.emscriptenVersion !== '3.1.64'
		|| manifest.toolchain?.dockerImage !== 'emscripten/emsdk:3.1.64'
		|| manifest.toolchain?.dockerImageDigest !== 'sha256:8847dad4171ebc8a53d9ae5cda86a2546ef5b2e68834c14dc1ba2b2962e125cc') {
		findings.push('Ogg Opus toolchain admission changed.');
	}
	if (JSON.stringify(manifest.buildFeatures) !== JSON.stringify({
		customModes: false, deepPlc: false, dred: false, files: false, mappingFamily: 0,
		maximumChannels: 2, osce: false, packetMilliseconds: 20, qext: false,
		sampleRate: 48_000, simd: false, threads: false,
	})) findings.push('Ogg Opus public build profile changed.');
	if (JSON.stringify(manifest.configureArguments?.opus) !== JSON.stringify([
		'--disable-shared', '--enable-static', '--disable-dependency-tracking', '--disable-doc',
		'--disable-extra-programs', '--disable-asm', '--disable-rtcd', '--disable-intrinsics',
		'--disable-custom-modes', '--disable-opus-custom-api', '--disable-qext', '--disable-dred',
		'--disable-deep-plc', '--disable-lossgen', '--disable-osce', '--disable-osce-training-data',
	]) || JSON.stringify(manifest.configureArguments?.ogg) !== JSON.stringify([
		'--disable-shared', '--enable-static', '--disable-dependency-tracking',
	])) findings.push('Ogg Opus configure admission changed.');
	const evidence = manifest.compiledArchiveEvidence;
	if (evidence?.opusMemberCount !== 137
		|| evidence?.opusMembersSha256 !== 'dd54f6b221cb3459dc935edc75f25918dc86d76ab956476bec2aa43251105270'
		|| evidence?.oggMemberCount !== 2
		|| evidence?.oggMembersSha256 !== '54ff59975ee6f8cf0011df44e673d566d34dfe917e948cb805a832d30d28710a') {
		findings.push('Ogg Opus compiled archive membership evidence changed.');
	}
	if (manifest.wasm?.initialMemoryBytes !== 8 * 1024 * 1024
		|| manifest.wasm?.maximumMemoryBytes !== 256 * 1024 * 1024
		|| manifest.wasm?.stackBytes !== 256 * 1024) findings.push('Ogg Opus linear-memory limits changed.');
}

function auditArtifact(wasm, manifest, findings) {
	const path = join(opusDirectory, manifest.wasm.path);
	if (statSync(path).size > manifest.wasm.maximumBytes) findings.push('Ogg Opus artifact exceeds its byte limit.');
	const hash = sha256(wasm);
	if (!/^[0-9a-f]{64}$/u.test(manifest.wasm.sha256)) findings.push('Ogg Opus artifact digest is not pinned.');
	else if (hash !== manifest.wasm.sha256) findings.push(`Ogg Opus artifact digest mismatch: ${hash}`);
	if (wasm.includes(Buffer.from(root))) findings.push('Ogg Opus artifact embeds the local checkout path.');
	try {
		const memories = readDefinedMemoryLimits(wasm);
		if (memories.length !== 1) findings.push(`Expected one Ogg Opus WASM memory, found ${String(memories.length)}.`);
		else {
			const [memory] = memories;
			if (memory.memory64 || memory.shared) findings.push('Ogg Opus WASM memory is shared or memory64.');
			if (memory.minimumPages * wasmPageBytes !== manifest.wasm.initialMemoryBytes
				|| memory.maximumPages === null
				|| memory.maximumPages * wasmPageBytes !== manifest.wasm.maximumMemoryBytes) {
				findings.push('Ogg Opus WASM memory bounds do not match the manifest.');
			}
		}
	} catch (error) { findings.push(`Could not inspect Ogg Opus WASM memory: ${error.message}`); }
}

async function auditModule(wasm, manifest, findings) {
	let module;
	try { module = await WebAssembly.compile(wasm); }
	catch (error) { findings.push(`Invalid Ogg Opus WebAssembly: ${error.message}`); return; }
	const allowedImports = new Set(manifest.wasm.allowedFunctionImports);
	const actualImports = [];
	const imports = {};
	for (const descriptor of WebAssembly.Module.imports(module)) {
		const key = `${descriptor.module}.${descriptor.name}`;
		actualImports.push(key);
		if (descriptor.kind !== 'function' || !allowedImports.has(key)) {
			findings.push(`Forbidden Ogg Opus WASM import: ${descriptor.kind} ${key}`);
		}
		imports[descriptor.module] ||= {};
		imports[descriptor.module][descriptor.name] = () => 0;
	}
	if (JSON.stringify(actualImports.sort()) !== JSON.stringify([...allowedImports].sort())) {
		findings.push('Ogg Opus WASM import inventory does not exactly match its manifest.');
	}
	const exports = new Set(WebAssembly.Module.exports(module).map((descriptor) => descriptor.name));
	for (const name of manifest.wasm.requiredExports) {
		if (!exports.has(name) && !exports.has(`_${name}`)) findings.push(`Missing Ogg Opus WASM export: ${name}`);
	}
	if (findings.some((finding) => finding.startsWith('Forbidden Ogg Opus WASM import:'))) return;
	try {
		const instance = await WebAssembly.instantiate(module, imports);
		const api = instance.exports;
		const exported = (name) => api[name] || api[`_${name}`];
		exported('_initialize')?.();
		if (exported('scop_abi_version')() !== 2 || exported('scop_sample_rate')() !== 48_000
			|| exported('scop_maximum_channels')() !== 2
			|| exported('scop_maximum_frames')() !== 33_554_432
			|| exported('scop_maximum_vbr_mode')() !== 2
			|| exported('scop_initial_memory_bytes')() !== 8 * 1024 * 1024
			|| exported('scop_maximum_memory_bytes')() !== 256 * 1024 * 1024
			|| api.memory.buffer.byteLength !== 8 * 1024 * 1024) {
			findings.push('Ogg Opus WASM ABI limits changed.');
			return;
		}
		verifyCanary(api.memory, exported);
	} catch (error) { findings.push(`Ogg Opus WASM ABI canary failed: ${error.message}`); }
}

function verifyCanary(memory, exported) {
	const frames = 4_800;
	const channels = 2;
	const input = new Float32Array(frames * channels);
	for (let frame = 0; frame < frames; frame++) {
		input[frame * channels] = Math.sin(2 * Math.PI * 440 * frame / 48_000) * 0.4;
		input[frame * channels + 1] = Math.sin(2 * Math.PI * 660 * frame / 48_000) * 0.25;
	}
	const inputPointer = allocate(exported, memory, input.byteLength);
	const encodedCapacity = 64 * 1024;
	const encodedPointer = allocate(exported, memory, encodedCapacity);
	let decodePointer = 0;
	let outputPointer = 0;
	try {
		new Uint8Array(memory.buffer, inputPointer, input.byteLength).set(new Uint8Array(input.buffer));
		const encodedBytes = exported('scop_encode_float32')(
			inputPointer, frames, channels, 128_000, 1, encodedPointer, encodedCapacity,
		);
		if (!Number.isSafeInteger(encodedBytes) || encodedBytes < 64 || encodedBytes > encodedCapacity) {
			throw new Error('encoder returned an invalid byte count');
		}
		const encoded = Uint8Array.from(new Uint8Array(memory.buffer, encodedPointer, encodedBytes));
		const { preSkip, finalGranule } = inspectCanaryStream(encoded);
		if (finalGranule - BigInt(preSkip) !== BigInt(frames)) throw new Error('granule trimming mismatch');
		decodePointer = allocate(exported, memory, encoded.byteLength);
		outputPointer = allocate(exported, memory, input.byteLength);
		new Uint8Array(memory.buffer, decodePointer, encoded.byteLength).set(encoded);
		if (exported('scop_decode_float32')(
			decodePointer, encoded.byteLength, frames, channels, outputPointer, input.byteLength,
		) !== frames) throw new Error('decoder returned an invalid frame count');
		const decoded = new Float32Array(memory.buffer, outputPointer, input.length);
		let signalEnergy = 0;
		let errorEnergy = 0;
		for (let index = 0; index < input.length; index++) {
			if (!Number.isFinite(decoded[index])) throw new Error('decoder returned non-finite PCM');
			signalEnergy += input[index] ** 2;
			errorEnergy += (input[index] - decoded[index]) ** 2;
		}
		if (10 * Math.log10(signalEnergy / errorEnergy) < 20) throw new Error('lossy round-trip SNR is too low');
	} finally {
		if (outputPointer) exported('scop_free')(outputPointer);
		if (decodePointer) exported('scop_free')(decodePointer);
		exported('scop_free')(encodedPointer);
		exported('scop_free')(inputPointer);
	}
}

function inspectCanaryStream(bytes) {
	let offset = 0;
	let preSkip = null;
	let finalGranule = null;
	while (offset < bytes.byteLength) {
		if (Buffer.from(bytes.subarray(offset, offset + 4)).toString('ascii') !== 'OggS') throw new Error('bad capture');
		const segments = bytes[offset + 26];
		let bodyBytes = 0;
		for (let index = 0; index < segments; index++) bodyBytes += bytes[offset + 27 + index];
		if (offset === 0) preSkip = bytes[offset + 38] | bytes[offset + 39] << 8;
		if (bytes[offset + 5] & 4) finalGranule = readU64(bytes, offset + 6);
		offset += 27 + segments + bodyBytes;
	}
	if (offset !== bytes.byteLength || preSkip === null || finalGranule === null) throw new Error('incomplete stream');
	return { preSkip, finalGranule };
}

function allocate(exported, memory, bytes) {
	const pointer = exported('scop_allocate')(bytes);
	if (!Number.isSafeInteger(pointer) || pointer <= 0 || pointer + bytes > memory.buffer.byteLength) {
		throw new Error('allocation failed');
	}
	return pointer;
}

function readU64(bytes, offset) {
	const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
	return view.getBigUint64(0, true);
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
	const result = await auditOpusWasm();
	if (!result.ok) {
		process.stderr.write(`${result.findings.join('\n')}\n`);
		process.exitCode = 1;
	} else {
		process.stdout.write(`Ogg Opus WASM audit passed (${String(result.wasmBytes)} bytes, ${result.wasmSha256}).\n`);
	}
}

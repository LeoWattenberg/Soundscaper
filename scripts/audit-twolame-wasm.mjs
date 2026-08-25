#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const twolameDirectory = join(root, 'src/common/editor/twolame');
const manifestPath = join(twolameDirectory, 'source-manifest.json');
const wasmPageBytes = 65_536;

export async function auditTwolameWasm() {
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
	const findings = [];
	validateManifest(manifest, findings);
	for (const file of manifest.localFiles || []) {
		try {
			if (sha256(readFileSync(join(twolameDirectory, file.path))) !== file.sha256) {
				findings.push(`Local TwoLAME file hash mismatch: ${file.path}`);
			}
		} catch { findings.push(`Missing local TwoLAME file: ${String(file.path)}`); }
	}
	let wasm = null;
	try { wasm = readFileSync(join(twolameDirectory, manifest.wasm.path)); }
	catch { findings.push(`Missing TwoLAME artifact: ${String(manifest.wasm?.path)}`); }
	if (wasm) {
		auditArtifact(wasm, manifest, findings);
		await auditModule(wasm, manifest, findings);
	}
	return Object.freeze({
		ok: findings.length === 0,
		findings: Object.freeze(findings),
		version: manifest.twolame?.tag ?? null,
		revision: manifest.twolame?.revision ?? null,
		archiveSha256: manifest.twolame?.archiveSha256 ?? null,
		wasmBytes: wasm?.byteLength ?? null,
		wasmSha256: wasm ? sha256(wasm) : null,
	});
}

function validateManifest(manifest, findings) {
	if (manifest.schemaVersion !== 1 || manifest.twolame?.tag !== '0.4.0'
		|| manifest.twolame?.revision !== 'bec4069996479aa1aa9d9e7fa32c33135b3a2047'
		|| manifest.twolame?.license !== 'LGPL-2.1-or-later'
		|| manifest.twolame?.archiveUrl !== 'https://downloads.sourceforge.net/project/twolame/twolame/0.4.0/twolame-0.4.0.tar.gz'
		|| manifest.twolame?.archiveSha256 !== 'cc35424f6019a88c6f52570b63e1baf50f62963a3eac52a03a800bb070d7c87d') {
		findings.push('TwoLAME source admission is not pinned to official 0.4.0.');
	}
	if (manifest.toolchain?.emscriptenVersion !== '3.1.64'
		|| manifest.toolchain?.dockerImage !== 'emscripten/emsdk:3.1.64'
		|| manifest.toolchain?.dockerImageDigest !== 'sha256:8847dad4171ebc8a53d9ae5cda86a2546ef5b2e68834c14dc1ba2b2962e125cc'
		|| manifest.toolchain?.sourceDateEpoch !== '1570818420') {
		findings.push('TwoLAME toolchain admission changed.');
	}
	if (JSON.stringify(manifest.configureArguments) !== JSON.stringify([
		'--disable-shared', '--enable-static', '--disable-dependency-tracking', '--disable-sndfile',
	])) findings.push('TwoLAME configure admission changed.');
	if (JSON.stringify(manifest.buildFeatures) !== JSON.stringify({
		cli: false, decoder: false, files: false, inputConversion: 'clamp-unit-f32-to-signed-16',
		layers: [2], maximumChannels: 2, sampleRates: [32_000, 44_100, 48_000],
		simd: false, threads: false, vbr: false,
	})) findings.push('TwoLAME public build profile changed.');
	if (manifest.compiledArchiveEvidence?.memberCount !== 19
		|| manifest.compiledArchiveEvidence?.membersSha256
		!== 'ed772fa8f8ce35e285e4c4e284bdb69c0392b0558ba904cd2a457b5af0933b70') {
		findings.push('TwoLAME compiled archive membership evidence changed.');
	}
	if (manifest.wasm?.initialMemoryBytes !== 8 * 1024 * 1024
		|| manifest.wasm?.maximumMemoryBytes !== 256 * 1024 * 1024
		|| manifest.wasm?.stackBytes !== 256 * 1024) findings.push('TwoLAME linear-memory limits changed.');
}

function auditArtifact(wasm, manifest, findings) {
	const path = join(twolameDirectory, manifest.wasm.path);
	if (statSync(path).size > manifest.wasm.maximumBytes) findings.push('TwoLAME artifact exceeds its byte limit.');
	const hash = sha256(wasm);
	if (!/^[0-9a-f]{64}$/u.test(manifest.wasm.sha256)) findings.push('TwoLAME artifact digest is not pinned.');
	else if (hash !== manifest.wasm.sha256) findings.push(`TwoLAME artifact digest mismatch: ${hash}`);
	if (wasm.includes(Buffer.from(root))) findings.push('TwoLAME artifact embeds the local checkout path.');
	try {
		const memories = readDefinedMemoryLimits(wasm);
		if (memories.length !== 1) findings.push(`Expected one TwoLAME WASM memory, found ${String(memories.length)}.`);
		else {
			const [memory] = memories;
			if (memory.memory64 || memory.shared) findings.push('TwoLAME WASM memory is shared or memory64.');
			if (memory.minimumPages * wasmPageBytes !== manifest.wasm.initialMemoryBytes
				|| memory.maximumPages === null
				|| memory.maximumPages * wasmPageBytes !== manifest.wasm.maximumMemoryBytes) {
				findings.push('TwoLAME WASM memory bounds do not match the manifest.');
			}
		}
	} catch (error) { findings.push(`Could not inspect TwoLAME WASM memory: ${error.message}`); }
}

async function auditModule(wasm, manifest, findings) {
	let module;
	try { module = await WebAssembly.compile(wasm); }
	catch (error) { findings.push(`Invalid TwoLAME WebAssembly: ${error.message}`); return; }
	const allowedImports = new Set(manifest.wasm.allowedFunctionImports);
	const actualImports = [];
	const imports = {};
	for (const descriptor of WebAssembly.Module.imports(module)) {
		const key = `${descriptor.module}.${descriptor.name}`;
		actualImports.push(key);
		if (descriptor.kind !== 'function' || !allowedImports.has(key)) {
			findings.push(`Forbidden TwoLAME WASM import: ${descriptor.kind} ${key}`);
		}
		imports[descriptor.module] ||= {};
		imports[descriptor.module][descriptor.name] = () => 8;
	}
	if (JSON.stringify(actualImports.sort()) !== JSON.stringify([...allowedImports].sort())) {
		findings.push('TwoLAME WASM import inventory does not exactly match its manifest.');
	}
	const exports = new Set(WebAssembly.Module.exports(module).map((descriptor) => descriptor.name));
	for (const name of manifest.wasm.requiredExports) {
		if (!exports.has(name) && !exports.has(`_${name}`)) findings.push(`Missing TwoLAME WASM export: ${name}`);
	}
	if (findings.some((finding) => finding.startsWith('Forbidden TwoLAME WASM import:'))) return;
	try {
		const instance = await WebAssembly.instantiate(module, imports);
		const api = instance.exports;
		const exported = (name) => api[name] || api[`_${name}`];
		exported('_initialize')?.();
		if (exported('sctl_abi_version')() !== 1 || exported('sctl_twolame_major')() !== 0
			|| exported('sctl_twolame_minor')() !== 4 || exported('sctl_twolame_patch')() !== 0
			|| exported('sctl_maximum_channels')() !== 2
			|| exported('sctl_maximum_frames')() !== 8_388_608
			|| exported('sctl_initial_memory_bytes')() !== 8 * 1024 * 1024
			|| exported('sctl_maximum_memory_bytes')() !== 256 * 1024 * 1024
			|| api.memory.buffer.byteLength !== 8 * 1024 * 1024) {
			findings.push('TwoLAME WASM ABI limits changed.');
			return;
		}
		verifyCanary(api.memory, exported);
	} catch (error) { findings.push(`TwoLAME WASM ABI canary failed: ${error.message}`); }
}

function verifyCanary(memory, exported) {
	const frames = 2_305;
	const channels = 2;
	const sampleRate = 44_100;
	const bitrateKbps = 192;
	const input = new Float32Array(frames * channels);
	for (let frame = 0; frame < frames; frame++) {
		input[frame * channels] = Math.sin(2 * Math.PI * 440 * frame / sampleRate) * 0.35;
		input[frame * channels + 1] = Math.sin(2 * Math.PI * 660 * frame / sampleRate) * 0.25;
	}
	const inputPointer = allocate(exported, memory, input.byteLength);
	const capacity = 64 * 1024;
	const outputPointer = allocate(exported, memory, capacity);
	try {
		new Uint8Array(memory.buffer, inputPointer, input.byteLength).set(new Uint8Array(input.buffer));
		const outputBytes = exported('sctl_encode_float32')(
			inputPointer, frames, channels, sampleRate, bitrateKbps, outputPointer, capacity,
		);
		if (!Number.isSafeInteger(outputBytes) || outputBytes < 100 || outputBytes > capacity) {
			throw new Error('encoder returned an invalid byte count');
		}
		const output = new Uint8Array(memory.buffer, outputPointer, outputBytes);
		let offset = 0;
		let mpegFrames = 0;
		while (offset < output.byteLength) {
			if (offset + 4 > output.byteLength) throw new Error('truncated MP2 header');
			const word = new DataView(output.buffer, output.byteOffset + offset, 4).getUint32(0, false);
			if (word >>> 21 !== 0x7ff || (word >>> 19 & 3) !== 3 || (word >>> 17 & 3) !== 2
				|| (word >>> 16 & 1) !== 1 || (word >>> 12 & 15) !== 10
				|| (word >>> 10 & 3) !== 0 || (word >>> 6 & 3) !== 0) {
				throw new Error('encoder emitted an unexpected MPEG-1 Layer II header');
			}
			const frameBytes = Math.floor(144 * bitrateKbps * 1_000 / sampleRate) + (word >>> 9 & 1);
			offset += frameBytes;
			mpegFrames++;
		}
		if (offset !== output.byteLength || mpegFrames !== Math.ceil(frames / 1_152)) {
			throw new Error('encoder emitted unexpected frame geometry');
		}
	} finally {
		exported('sctl_free')(outputPointer);
		exported('sctl_free')(inputPointer);
	}
}

function allocate(exported, memory, bytes) {
	const pointer = exported('sctl_allocate')(bytes);
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
	const result = await auditTwolameWasm();
	if (!result.ok) {
		process.stderr.write(`${result.findings.join('\n')}\n`);
		process.exitCode = 1;
	} else {
		process.stdout.write(`TwoLAME WASM audit passed (${String(result.wasmBytes)} bytes, ${result.wasmSha256}).\n`);
	}
}

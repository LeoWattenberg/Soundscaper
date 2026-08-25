#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vorbisDirectory = join(root, 'src/common/editor/vorbis');
const manifestPath = join(vorbisDirectory, 'source-manifest.json');
const wasmPageBytes = 65_536;

export async function auditVorbisWasm() {
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
	const findings = [];
	validateManifest(manifest, findings);
	for (const file of manifest.localFiles || []) {
		try {
			if (sha256(readFileSync(join(vorbisDirectory, file.path))) !== file.sha256) {
				findings.push(`Local Ogg Vorbis file hash mismatch: ${file.path}`);
			}
		} catch { findings.push(`Missing local Ogg Vorbis file: ${String(file.path)}`); }
	}
	let wasm = null;
	try { wasm = readFileSync(join(vorbisDirectory, manifest.wasm.path)); }
	catch { findings.push(`Missing Ogg Vorbis artifact: ${String(manifest.wasm?.path)}`); }
	if (wasm) {
		auditArtifact(wasm, manifest, findings);
		await auditModule(wasm, manifest, findings);
	}
	return Object.freeze({
		ok: findings.length === 0,
		findings: Object.freeze(findings),
		vorbisVersion: manifest.vorbis?.tag?.replace(/^v/u, '') ?? null,
		oggVersion: manifest.ogg?.tag?.replace(/^v/u, '') ?? null,
		vorbisRevision: manifest.vorbis?.revision ?? null,
		oggRevision: manifest.ogg?.revision ?? null,
		vorbisArchiveSha256: manifest.vorbis?.archiveSha256 ?? null,
		oggArchiveSha256: manifest.ogg?.archiveSha256 ?? null,
		wasmBytes: wasm?.byteLength ?? null,
		wasmSha256: wasm ? sha256(wasm) : null,
	});
}

function validateManifest(manifest, findings) {
	if (manifest.schemaVersion !== 1 || manifest.vorbis?.tag !== 'v1.3.7'
		|| manifest.vorbis?.revision !== '0657aee69dec8508a0011f47f3b69d7538e9d262'
		|| manifest.vorbis?.license !== 'BSD-3-Clause'
		|| manifest.vorbis?.archiveUrl !== 'https://downloads.xiph.org/releases/vorbis/libvorbis-1.3.7.tar.xz'
		|| manifest.vorbis?.archiveSha256 !== 'b33cc4934322bcbf6efcbacf49e3ca01aadbea4114ec9589d1b1e9d20f72954b') {
		findings.push('libvorbis source admission is not pinned to official 1.3.7.');
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
		findings.push('Ogg Vorbis toolchain admission changed.');
	}
	if (JSON.stringify(manifest.buildFeatures) !== JSON.stringify({
		files: false, maximumChannels: 2, maximumSampleRate: 192_000, minimumSampleRate: 8_000,
		qualityMaximum: 10, qualityMinimum: 0, simd: false, threads: false,
	})) findings.push('Ogg Vorbis public build profile changed.');
	if (JSON.stringify(manifest.configureArguments?.vorbis) !== JSON.stringify([
		'--disable-shared', '--enable-static', '--disable-dependency-tracking', '--disable-docs',
		'--disable-examples', '--disable-oggtest',
	]) || JSON.stringify(manifest.configureArguments?.ogg) !== JSON.stringify([
		'--disable-shared', '--enable-static', '--disable-dependency-tracking',
	])) findings.push('Ogg Vorbis configure admission changed.');
	const evidence = manifest.compiledArchiveEvidence;
	if (evidence?.vorbisMemberCount !== 20
		|| evidence?.vorbisMembersSha256 !== '7a6013f07ece1762054788649a68479ead8c52aa7d65a4f87b42a35fe5089909'
		|| evidence?.vorbisEncMemberCount !== 1
		|| evidence?.vorbisEncMembersSha256 !== '50efbd758bbe46436e1672369ddbb0b8ce2a51af12bfa0fde9e7739ac5b05b5a'
		|| evidence?.vorbisFileMemberCount !== 1
		|| evidence?.vorbisFileMembersSha256 !== 'a9fca99c38f498c08428c59e3b904db0200c9414256d9796aef335b4f55739da'
		|| evidence?.oggMemberCount !== 2
		|| evidence?.oggMembersSha256 !== '54ff59975ee6f8cf0011df44e673d566d34dfe917e948cb805a832d30d28710a') {
		findings.push('Ogg Vorbis compiled archive membership evidence changed.');
	}
	if (manifest.wasm?.initialMemoryBytes !== 8 * 1024 * 1024
		|| manifest.wasm?.maximumMemoryBytes !== 256 * 1024 * 1024
		|| manifest.wasm?.stackBytes !== 1024 * 1024) findings.push('Ogg Vorbis linear-memory limits changed.');
}

function auditArtifact(wasm, manifest, findings) {
	const path = join(vorbisDirectory, manifest.wasm.path);
	if (statSync(path).size > manifest.wasm.maximumBytes) findings.push('Ogg Vorbis artifact exceeds its byte limit.');
	const hash = sha256(wasm);
	if (!/^[0-9a-f]{64}$/u.test(manifest.wasm.sha256)) findings.push('Ogg Vorbis artifact digest is not pinned.');
	else if (hash !== manifest.wasm.sha256) findings.push(`Ogg Vorbis artifact digest mismatch: ${hash}`);
	if (wasm.includes(Buffer.from(root))) findings.push('Ogg Vorbis artifact embeds the local checkout path.');
	try {
		const memories = readDefinedMemoryLimits(wasm);
		if (memories.length !== 1) findings.push(`Expected one Ogg Vorbis WASM memory, found ${String(memories.length)}.`);
		else {
			const [memory] = memories;
			if (memory.memory64 || memory.shared) findings.push('Ogg Vorbis WASM memory is shared or memory64.');
			if (memory.minimumPages * wasmPageBytes !== manifest.wasm.initialMemoryBytes
				|| memory.maximumPages === null
				|| memory.maximumPages * wasmPageBytes !== manifest.wasm.maximumMemoryBytes) {
				findings.push('Ogg Vorbis WASM memory bounds do not match the manifest.');
			}
		}
	} catch (error) { findings.push(`Could not inspect Ogg Vorbis WASM memory: ${error.message}`); }
}

async function auditModule(wasm, manifest, findings) {
	let module;
	try { module = await WebAssembly.compile(wasm); }
	catch (error) { findings.push(`Invalid Ogg Vorbis WebAssembly: ${error.message}`); return; }
	const allowedImports = new Set(manifest.wasm.allowedFunctionImports);
	const actualImports = [];
	const imports = {};
	for (const descriptor of WebAssembly.Module.imports(module)) {
		const key = `${descriptor.module}.${descriptor.name}`;
		actualImports.push(key);
		if (descriptor.kind !== 'function' || !allowedImports.has(key)) {
			findings.push(`Forbidden Ogg Vorbis WASM import: ${descriptor.kind} ${key}`);
		}
		imports[descriptor.module] ||= {};
		imports[descriptor.module][descriptor.name] = () => 0;
	}
	if (JSON.stringify(actualImports.sort()) !== JSON.stringify([...allowedImports].sort())) {
		findings.push('Ogg Vorbis WASM import inventory does not exactly match its manifest.');
	}
	const exports = new Set(WebAssembly.Module.exports(module).map((descriptor) => descriptor.name));
	for (const name of manifest.wasm.requiredExports) {
		if (!exports.has(name) && !exports.has(`_${name}`)) findings.push(`Missing Ogg Vorbis WASM export: ${name}`);
	}
	if (findings.some((finding) => finding.startsWith('Forbidden Ogg Vorbis WASM import:'))) return;
	try {
		const instance = await WebAssembly.instantiate(module, imports);
		const api = instance.exports;
		const exported = (name) => api[name] || api[`_${name}`];
		exported('_initialize')?.();
		if (exported('scvb_abi_version')() !== 1 || exported('scvb_minimum_sample_rate')() !== 8_000
			|| exported('scvb_maximum_sample_rate')() !== 192_000
			|| exported('scvb_maximum_channels')() !== 2
			|| exported('scvb_maximum_frames')() !== 33_554_432
			|| exported('scvb_initial_memory_bytes')() !== 8 * 1024 * 1024
			|| exported('scvb_maximum_memory_bytes')() !== 256 * 1024 * 1024
			|| api.memory.buffer.byteLength !== 8 * 1024 * 1024) {
			findings.push('Ogg Vorbis WASM ABI limits changed.');
			return;
		}
		verifyCanary(api.memory, exported);
	} catch (error) { findings.push(`Ogg Vorbis WASM ABI canary failed: ${error.message}`); }
}

function verifyCanary(memory, exported) {
	const frames = 4_800;
	const channels = 2;
	const sampleRate = 48_000;
	const input = new Float32Array(frames * channels);
	for (let frame = 0; frame < frames; frame++) {
		input[frame * channels] = Math.sin(2 * Math.PI * 440 * frame / sampleRate) * 0.35;
		input[frame * channels + 1] = Math.sin(2 * Math.PI * 660 * frame / sampleRate) * 0.25;
	}
	const inputPointer = allocate(exported, memory, input.byteLength);
	const encodedCapacity = 64 * 1024;
	const encodedPointer = allocate(exported, memory, encodedCapacity);
	let decodePointer = 0;
	let outputPointer = 0;
	try {
		new Uint8Array(memory.buffer, inputPointer, input.byteLength).set(new Uint8Array(input.buffer));
		const encodedBytes = exported('scvb_encode_float32')(
			inputPointer, frames, channels, sampleRate, 6, encodedPointer, encodedCapacity,
		);
		if (!Number.isSafeInteger(encodedBytes) || encodedBytes < 96 || encodedBytes > encodedCapacity) {
			throw new Error('encoder returned an invalid byte count');
		}
		const encoded = Uint8Array.from(new Uint8Array(memory.buffer, encodedPointer, encodedBytes));
		if (String.fromCharCode(...encoded.subarray(0, 4)) !== 'OggS') throw new Error('encoder omitted Ogg capture');
		decodePointer = allocate(exported, memory, encoded.byteLength);
		outputPointer = allocate(exported, memory, input.byteLength);
		new Uint8Array(memory.buffer, decodePointer, encoded.byteLength).set(encoded);
		if (exported('scvb_validate')(decodePointer, encoded.byteLength) !== 1) {
			throw new Error('decoder validity probe rejected canary');
		}
		if (exported('scvb_probe')(
			decodePointer, encoded.byteLength, frames, channels, sampleRate,
		) !== 1) throw new Error('decoder probe rejected canary geometry');
		if (exported('scvb_decode_float32')(
			decodePointer, encoded.byteLength, frames, channels, sampleRate,
			outputPointer, input.byteLength,
		) !== frames) throw new Error('decoder returned an invalid frame count');
		const decoded = new Float32Array(memory.buffer, outputPointer, input.length);
		let signal = 0;
		let error = 0;
		for (let index = 0; index < input.length; index++) {
			if (!Number.isFinite(decoded[index])) throw new Error('decoder returned non-finite PCM');
			signal += input[index] ** 2;
			error += (input[index] - decoded[index]) ** 2;
		}
		if (10 * Math.log10(signal / error) < 20) throw new Error('lossy round-trip SNR is too low');
	} finally {
		if (outputPointer) exported('scvb_free')(outputPointer);
		if (decodePointer) exported('scvb_free')(decodePointer);
		exported('scvb_free')(encodedPointer);
		exported('scvb_free')(inputPointer);
	}
}

function allocate(exported, memory, bytes) {
	const pointer = exported('scvb_allocate')(bytes);
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
	const result = await auditVorbisWasm();
	if (!result.ok) {
		process.stderr.write(`${result.findings.join('\n')}\n`);
		process.exitCode = 1;
	} else {
		process.stdout.write(`Ogg Vorbis WASM audit passed (${String(result.wasmBytes)} bytes, ${result.wasmSha256}).\n`);
	}
}

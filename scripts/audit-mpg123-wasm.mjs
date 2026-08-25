#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDirectory = join(root, 'src/common/editor/mpg123');
const manifestPath = join(sourceDirectory, 'source-manifest.json');
const wasmPageBytes = 65_536;

export async function auditMpg123Wasm() {
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
	const findings = [];
	validateManifest(manifest, findings);
	for (const file of manifest.localFiles || []) {
		try {
			if (sha256(readFileSync(join(sourceDirectory, file.path))) !== file.sha256) {
				findings.push(`Local mpg123 file hash mismatch: ${file.path}`);
			}
		} catch { findings.push(`Missing local mpg123 file: ${String(file.path)}`); }
	}
	let wasm = null;
	try { wasm = readFileSync(join(sourceDirectory, manifest.wasm.path)); }
	catch { findings.push(`Missing mpg123 artifact: ${String(manifest.wasm?.path)}`); }
	if (wasm) {
		auditArtifact(wasm, manifest, findings);
		await auditModule(wasm, manifest, findings);
	}
	return Object.freeze({
		ok: findings.length === 0, findings: Object.freeze(findings),
		version: manifest.mpg123?.version ?? null,
		archiveSha256: manifest.mpg123?.archiveSha256 ?? null,
		signatureSha256: manifest.mpg123?.signatureSha256 ?? null,
		signingFingerprint: manifest.mpg123?.signingFingerprint ?? null,
		wasmBytes: wasm?.byteLength ?? null, wasmSha256: wasm ? sha256(wasm) : null,
	});
}

function validateManifest(manifest, findings) {
	const source = manifest.mpg123;
	if (manifest.schemaVersion !== 1 || source?.version !== '1.33.7'
		|| source?.license !== 'LGPL-2.1-only'
		|| source?.archiveUrl !== 'https://www.mpg123.de/download/mpg123-1.33.7.tar.bz2'
		|| source?.archiveSha256 !== '31d0e35a4ca567ec9b5ebda6c3062bb4435d6d3eacd6ef0d95cadd7854dc03ee'
		|| source?.signatureSha256 !== '48037de26dd56d479b5a54d91ba301d9958476bd03c1b135ee183c3b23c2793c'
		|| source?.signingKeySha256 !== '9e3ae1e90e6a2b4e3a0b3e70833bd7c6bf082ac61f3146846f99278558eec672'
		|| source?.signingFingerprint !== 'D021FF8ECF4BE09719D61A27231C4CBC60D5CAFE') {
		findings.push('mpg123 source admission is not pinned to the signed official 1.33.7 release.');
	}
	if (manifest.toolchain?.emscriptenVersion !== '3.1.64'
		|| manifest.toolchain?.dockerImage !== 'emscripten/emsdk:3.1.64'
		|| manifest.toolchain?.dockerImageDigest !== 'sha256:8847dad4171ebc8a53d9ae5cda86a2546ef5b2e68834c14dc1ba2b2962e125cc') {
		findings.push('mpg123 toolchain admission changed.');
	}
	if (JSON.stringify(manifest.buildFeatures) !== JSON.stringify({
		audioOutput: false, cli: false, files: false, gapless: true, icy: false,
		id3: false, layers: [2, 3], network: false, outputEncoding: 'float32',
		reader: 'feed', simd: false, threads: false,
	})) findings.push('mpg123 public build profile changed.');
	if (JSON.stringify(manifest.configureArguments) !== JSON.stringify([
		'--disable-components', '--enable-libmpg123', '--disable-shared', '--enable-static',
		'--disable-modules', '--disable-dependency-tracking', '--enable-portable', '--enable-gapless',
		'--enable-feeder', '--disable-id3v2', '--disable-icy', '--disable-network', '--with-network=none',
		'--disable-ntom', '--disable-downsample', '--disable-moreinfo', '--disable-messages',
		'--disable-16bit', '--disable-8bit', '--disable-32bit', '--disable-equalizer',
		'--disable-layer1', '--disable-feature_report', '--disable-buffer', '--disable-largefile',
		'--with-cpu=generic_fpu', '--with-seektable=0',
	])) findings.push('mpg123 configure admission changed.');
	if (manifest.compiledArchiveEvidence?.memberCount !== 16
		|| manifest.compiledArchiveEvidence?.membersSha256
			!== '00b526dc1e61810f1bd9920c3a8a239dbf572bc00f55e623a1ac0c0642048b19') {
		findings.push('mpg123 compiled archive membership evidence changed.');
	}
	if (manifest.wasm?.initialMemoryBytes !== 8 * 1024 * 1024
		|| manifest.wasm?.maximumMemoryBytes !== 256 * 1024 * 1024
		|| manifest.wasm?.stackBytes !== 256 * 1024) findings.push('mpg123 linear-memory limits changed.');
}

function auditArtifact(wasm, manifest, findings) {
	const path = join(sourceDirectory, manifest.wasm.path);
	if (statSync(path).size > manifest.wasm.maximumBytes) findings.push('mpg123 artifact exceeds its byte limit.');
	const hash = sha256(wasm);
	if (manifest.wasm.sha256 !== 'd2b5686a16141ec97dbeb4e4f2a1ce28b756dd3eaf6438b31379356c8dd958ae') {
		findings.push('mpg123 artifact digest is not the reviewed value.');
	} else if (hash !== manifest.wasm.sha256) findings.push(`mpg123 artifact digest mismatch: ${hash}`);
	if (wasm.includes(Buffer.from(root))) findings.push('mpg123 artifact embeds the local checkout path.');
	try {
		const memories = readDefinedMemoryLimits(wasm);
		if (memories.length !== 1) findings.push(`Expected one mpg123 WASM memory, found ${String(memories.length)}.`);
		else {
			const [memory] = memories;
			if (memory.memory64 || memory.shared) findings.push('mpg123 WASM memory is shared or memory64.');
			if (memory.minimumPages * wasmPageBytes !== manifest.wasm.initialMemoryBytes
				|| memory.maximumPages === null
				|| memory.maximumPages * wasmPageBytes !== manifest.wasm.maximumMemoryBytes) {
				findings.push('mpg123 WASM memory bounds do not match the manifest.');
			}
		}
	} catch (error) { findings.push(`Could not inspect mpg123 WASM memory: ${error.message}`); }
}

async function auditModule(wasm, manifest, findings) {
	let module;
	try { module = await WebAssembly.compile(wasm); }
	catch (error) { findings.push(`Invalid mpg123 WebAssembly: ${error.message}`); return; }
	const allowedImports = new Set(manifest.wasm.allowedFunctionImports);
	const actualImports = [];
	const imports = {};
	for (const descriptor of WebAssembly.Module.imports(module)) {
		const key = `${descriptor.module}.${descriptor.name}`;
		actualImports.push(key);
		if (descriptor.kind !== 'function' || !allowedImports.has(key)) {
			findings.push(`Forbidden mpg123 WASM import: ${descriptor.kind} ${key}`);
		}
		imports[descriptor.module] ||= {};
		imports[descriptor.module][descriptor.name] = () => 0;
	}
	if (JSON.stringify(actualImports.sort()) !== JSON.stringify([...allowedImports].sort())) {
		findings.push('mpg123 WASM import inventory does not exactly match its manifest.');
	}
	const exports = new Set(WebAssembly.Module.exports(module).map((descriptor) => descriptor.name));
	for (const name of manifest.wasm.requiredExports) {
		if (!exports.has(name) && !exports.has(`_${name}`)) findings.push(`Missing mpg123 WASM export: ${name}`);
	}
	if (findings.some((finding) => finding.startsWith('Forbidden mpg123 WASM import:'))) return;
	try {
		const instance = await WebAssembly.instantiate(module, imports);
		const api = instance.exports;
		const exported = (name) => api[name] || api[`_${name}`];
		exported('_initialize')?.();
		if (exported('scmp_abi_version')() !== 1 || exported('scmp_maximum_frames')() !== 33_554_432
			|| exported('scmp_initial_memory_bytes')() !== 8 * 1024 * 1024
			|| exported('scmp_maximum_memory_bytes')() !== 256 * 1024 * 1024
			|| api.memory.buffer.byteLength !== 8 * 1024 * 1024) {
			findings.push('mpg123 WASM ABI limits changed.');
			return;
		}
		verifyCanary(api.memory, exported);
	} catch (error) { findings.push(`mpg123 WASM ABI canary failed: ${error.message}`); }
}

function verifyCanary(memory, exported) {
	for (const candidate of [
		{ layer: 3, rate: 44_100, channels: 2, bitrate: 128 },
		{ layer: 2, rate: 48_000, channels: 1, bitrate: 192 },
	]) {
		const input = canaryStream(candidate);
		const frames = 4 * 1_152;
		const outputBytes = frames * candidate.channels * 4;
		const inputPointer = allocate(exported, memory, input.byteLength);
		const outputPointer = allocate(exported, memory, outputBytes);
		try {
			new Uint8Array(memory.buffer, inputPointer, input.byteLength).set(input);
			if (exported('scmp_decode_float32')(
				inputPointer, input.byteLength, frames, candidate.rate, candidate.channels,
				outputPointer, outputBytes,
			) !== frames) throw new Error('decoder returned an invalid frame count');
			for (const sample of new Float32Array(memory.buffer, outputPointer, outputBytes / 4)) {
				if (!Number.isFinite(sample)) throw new Error('decoder returned non-finite PCM');
			}
		} finally {
			exported('scmp_free')(outputPointer);
			exported('scmp_free')(inputPointer);
		}
	}
}

function canaryStream({ layer, rate, channels, bitrate }) {
	const bitrates = layer === 2
		? [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384]
		: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
	const frames = [];
	for (let index = 0; index < 4; index++) {
		const padding = index & 1;
		const frame = new Uint8Array(Math.floor(144 * bitrate * 1_000 / rate) + padding);
		const header = (0x7ff << 21) | (3 << 19) | ((layer === 2 ? 2 : 1) << 17) | (1 << 16)
			| (bitrates.indexOf(bitrate) << 12) | ([44_100, 48_000, 32_000].indexOf(rate) << 10)
			| (padding << 9) | ((channels === 1 ? 3 : 0) << 6);
		new DataView(frame.buffer).setUint32(0, header >>> 0, false);
		frames.push(frame);
	}
	const result = new Uint8Array(frames.reduce((sum, frame) => sum + frame.byteLength, 0));
	let offset = 0;
	for (const frame of frames) { result.set(frame, offset); offset += frame.byteLength; }
	return result;
}

function allocate(exported, memory, bytes) {
	const pointer = exported('scmp_allocate')(bytes);
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
	let result = 0;
	let shift = 0;
	let offset = start;
	while (offset < bytes.byteLength && shift <= 35) {
		const byte = bytes[offset++];
		result += (byte & 0x7f) * 2 ** shift;
		if ((byte & 0x80) === 0) return { value: result, nextOffset: offset };
		shift += 7;
	}
	throw new Error('invalid unsigned LEB128');
}

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const result = await auditMpg123Wasm();
	if (!result.ok) {
		for (const finding of result.findings) process.stderr.write(`- ${finding}\n`);
		process.exitCode = 1;
	} else process.stdout.write(
		`mpg123 ${result.version}: ${String(result.wasmBytes)} bytes, SHA-256 ${result.wasmSha256}\n`,
	);
}

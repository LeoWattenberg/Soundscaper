#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wavpackDirectory = join(root, 'src/lib/tools/audio-editor/wavpack');
const nativeDirectory = join(wavpackDirectory, 'native');
const manifestPath = join(wavpackDirectory, 'source-manifest.json');
const wasmPageBytes = 65_536;
const initialMemoryBytes = 8 * 1024 * 1024;
const maximumMemoryBytes = 128 * 1024 * 1024;
const prohibitedCompiledSources = new Set([
	'open_filename.c',
	'open_legacy.c',
	'open_raw.c',
	'pack_dsd.c',
	'tag_utils.c',
	'tags.c',
	'unpack3.c',
	'unpack3_open.c',
	'unpack3_seek.c',
	'unpack_dsd.c',
	'unpack_seek.c',
]);

export async function auditWavPackWasm(options = {}) {
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
	const findings = [];
	validateManifest(manifest, findings);

	const expectedSources = new Set(manifest.sourceFiles.map((source) => source.path));
	for (const path of listSourceFiles(nativeDirectory).map((value) => relative(nativeDirectory, value))) {
		if (!expectedSources.has(path)) findings.push(`Unexpected native source outside the allowlist: ${path}`);
	}
	for (const source of manifest.sourceFiles) {
		let bytes;
		try {
			bytes = readFileSync(join(nativeDirectory, source.path));
		} catch {
			findings.push(`Missing pinned source: ${source.path}`);
			continue;
		}
		const hash = sha256(bytes);
		if (hash !== source.sha256) findings.push(`Source hash mismatch for ${source.path}: ${hash}`);
	}
	for (const source of manifest.compiledSources) {
		if (!expectedSources.has(source)) findings.push(`Compiled source is not pinned: ${source}`);
		if (prohibitedCompiledSources.has(source)
			|| /\.(?:s|asm)$/i.test(source)
			|| /(?:x86|x64|armv7)/i.test(source)) {
			findings.push(`Forbidden WavPack feature source is compiled: ${source}`);
		}
	}

	const expectedExtensions = new Set(manifest.localExtensions.map((extension) => extension.path));
	const actualExtensions = readdirSync(wavpackDirectory, { withFileTypes: true })
		.filter((entry) => entry.isFile() && extname(entry.name) === '.js')
		.map((entry) => entry.name)
		.sort();
	for (const path of actualExtensions) {
		if (!expectedExtensions.has(path)) findings.push(`Unexpected local WavPack extension outside the allowlist: ${path}`);
	}
	for (const extension of manifest.localExtensions) {
		try {
			const hash = sha256(readFileSync(join(wavpackDirectory, extension.path)));
			if (hash !== extension.sha256) {
				findings.push(`Local WavPack extension hash mismatch for ${extension.path}: ${hash}`);
			}
		} catch {
			findings.push(`Missing local WavPack extension: ${extension.path}`);
		}
	}
	for (const license of manifest.licenseFiles) {
		try {
			const hash = sha256(readFileSync(join(wavpackDirectory, license.path)));
			if (hash !== license.sha256) findings.push(`Notice/license hash mismatch for ${license.path}: ${hash}`);
		} catch {
			findings.push(`Missing notice/license: ${license.path}`);
		}
	}

	let wasm = null;
	if (!options.sourcesOnly) {
		const wasmPath = join(wavpackDirectory, manifest.wasm.path);
		try {
			wasm = readFileSync(wasmPath);
		} catch {
			findings.push(`Missing WavPack artifact: ${relative(root, wasmPath)}`);
		}
		if (wasm) {
			auditArtifactBytes(wasmPath, wasm, manifest, findings);
			await auditModule(wasm, manifest, findings);
		}
	}

	return {
		ok: findings.length === 0,
		findings,
		sourceCount: manifest.sourceFiles.length,
		localExtensionCount: manifest.localExtensions.length,
		wasmBytes: wasm?.byteLength ?? null,
		wasmSha256: wasm ? sha256(wasm) : null,
	};
}

function validateManifest(manifest, findings) {
	if (manifest.schemaVersion !== 1) findings.push(`Unsupported source-manifest schema: ${manifest.schemaVersion}`);
	if (manifest.wavpack?.tag !== '5.9.0'
		|| manifest.wavpack?.revision !== '5803634a030e2a11dba602ba057b89cc34486c67'
		|| manifest.wavpack?.license !== 'BSD-3-Clause') {
		findings.push('WavPack must remain pinned to BSD-3-Clause 5.9.0 commit 5803634a030e2a11dba602ba057b89cc34486c67.');
	}
	if (manifest.toolchain?.emscriptenVersion !== '3.1.64') {
		findings.push('WavPack WASM must remain pinned to Emscripten 3.1.64.');
	}
	for (const definition of ['NO_TAGS=1', 'NDEBUG=1', 'HAVE___BUILTIN_CLZ=1']) {
		if (!manifest.buildDefinitions?.includes(definition)) {
			findings.push(`WavPack build definition is missing: ${definition}`);
		}
	}
	if (manifest.buildFeatures?.dsd !== false
		|| manifest.buildFeatures?.legacyDecoder !== false
		|| manifest.buildFeatures?.seekApi !== false
		|| manifest.buildFeatures?.simd !== false
		|| manifest.buildFeatures?.threads !== false
		|| manifest.buildFeatures?.tags !== false) {
		findings.push('WavPack manifest must disable DSD, legacy, seek API, SIMD, threads, and tags.');
	}
	if (manifest.wasm?.initialMemoryBytes !== initialMemoryBytes
		|| manifest.wasm?.maximumMemoryBytes !== maximumMemoryBytes) {
		findings.push('WavPack manifest must enforce 8 MiB initial and 128 MiB maximum linear memory.');
	}
}

function auditArtifactBytes(wasmPath, wasm, manifest, findings) {
	if (statSync(wasmPath).size > manifest.wasm.maximumBytes) {
		findings.push(`WavPack artifact exceeds ${manifest.wasm.maximumBytes} bytes.`);
	}
	const hash = sha256(wasm);
	if (!manifest.wasm.sha256) findings.push('WavPack artifact hash is not pinned in source-manifest.json.');
	else if (hash !== manifest.wasm.sha256) findings.push(`WavPack artifact hash mismatch: ${hash}`);
	if (wasm.includes(Buffer.from(root))) findings.push('The WavPack artifact embeds the local checkout path.');
	try {
		const memories = readDefinedMemoryLimits(wasm);
		if (memories.length !== 1) {
			findings.push(`Expected exactly one defined WASM memory, found ${memories.length}.`);
		} else {
			const [memory] = memories;
			if (memory.memory64) findings.push('WavPack artifact unexpectedly uses memory64.');
			if (memory.shared) findings.push('WavPack artifact unexpectedly uses shared memory.');
			if (memory.minimumPages * wasmPageBytes !== manifest.wasm.initialMemoryBytes) {
				findings.push('WavPack artifact has an unexpected initial linear-memory limit.');
			}
			if (memory.maximumPages == null
				|| memory.maximumPages * wasmPageBytes !== manifest.wasm.maximumMemoryBytes) {
				findings.push('WavPack artifact has an unexpected maximum linear-memory limit.');
			}
		}
	} catch (error) {
		findings.push(`Could not audit WavPack linear-memory limits: ${error.message}`);
	}
}

async function auditModule(wasm, manifest, findings) {
	let module;
	try {
		module = await WebAssembly.compile(wasm);
	} catch (error) {
		findings.push(`Invalid WebAssembly artifact: ${error.message}`);
		return;
	}
	const allowedImports = new Set(manifest.wasm.allowedFunctionImports);
	const imports = {};
	for (const descriptor of WebAssembly.Module.imports(module)) {
		const key = `${descriptor.module}.${descriptor.name}`;
		if (descriptor.kind !== 'function' || !allowedImports.has(key)) {
			findings.push(`Forbidden WASM import: ${descriptor.kind} ${key}`);
		}
		imports[descriptor.module] ||= {};
		imports[descriptor.module][descriptor.name] = () => 0;
	}
	const exports = new Set(WebAssembly.Module.exports(module).map((descriptor) => descriptor.name));
	for (const name of manifest.wasm.requiredExports) {
		if (!exports.has(name) && !exports.has(`_${name}`)) findings.push(`Missing WASM export: ${name}`);
	}
	if (findings.some((finding) => finding.startsWith('Forbidden WASM import:'))) return;
	try {
		const instance = await WebAssembly.instantiate(module, imports);
		const api = instance.exports;
		const exported = (name) => api[name] || api[`_${name}`];
		exported('_initialize')?.();
		if (exported('scwp_abi_version')() !== 1
			|| exported('scwp_maximum_channels')() !== 64
			|| exported('scwp_maximum_frames')() !== 65_536
			|| exported('scwp_initial_memory_bytes')() !== initialMemoryBytes
			|| exported('scwp_maximum_memory_bytes')() !== maximumMemoryBytes
			|| api.memory.buffer.byteLength !== initialMemoryBytes) {
			findings.push('WavPack artifact reports unexpected ABI limits.');
		}
	} catch (error) {
		findings.push(`WavPack ABI smoke test failed: ${error.message}`);
	}
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
		if (sectionEnd > wasm.byteLength) throw new Error('section extends beyond the artifact');
		if (sectionId === 5) {
			const count = readUnsignedLeb(wasm, offset);
			offset = count.nextOffset;
			for (let index = 0; index < count.value; index += 1) {
				const flags = readUnsignedLeb(wasm, offset);
				offset = flags.nextOffset;
				const memory64 = Boolean(flags.value & 0x04);
				if (memory64) throw new Error('memory64 limits are not supported');
				const minimum = readUnsignedLeb(wasm, offset);
				offset = minimum.nextOffset;
				let maximumPages = null;
				if (flags.value & 0x01) {
					const maximum = readUnsignedLeb(wasm, offset);
					offset = maximum.nextOffset;
					maximumPages = maximum.value;
				}
				limits.push({
					minimumPages: minimum.value,
					maximumPages,
					shared: Boolean(flags.value & 0x02),
					memory64,
				});
			}
			if (offset !== sectionEnd) throw new Error('malformed memory section');
		}
		offset = sectionEnd;
	}
	return limits;
}

function readUnsignedLeb(bytes, startOffset) {
	let offset = startOffset;
	let value = 0;
	let multiplier = 1;
	for (let byteIndex = 0; byteIndex < 5; byteIndex += 1) {
		if (offset >= bytes.byteLength) throw new Error('truncated unsigned LEB128 value');
		const byte = bytes[offset++];
		value += (byte & 0x7f) * multiplier;
		if ((byte & 0x80) === 0) return { value, nextOffset: offset };
		multiplier *= 128;
	}
	throw new Error('unsigned LEB128 value exceeds 32 bits');
}

function listSourceFiles(directory) {
	const result = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) result.push(...listSourceFiles(path));
		else if (['.c', '.h'].includes(extname(entry.name))) result.push(path);
	}
	return result.sort();
}

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	const result = await auditWavPackWasm({ sourcesOnly: process.argv.includes('--sources-only') });
	if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
	else if (result.ok) {
		process.stdout.write(
			`WavPack audit passed (${result.sourceCount} pinned sources, ${result.localExtensionCount} local extensions${result.wasmBytes == null ? '' : `, ${result.wasmBytes} WASM bytes`}).\n`,
		);
	} else {
		process.stderr.write(`${result.findings.map((finding) => `- ${finding}`).join('\n')}\n`);
	}
	if (!result.ok) process.exitCode = 1;
}

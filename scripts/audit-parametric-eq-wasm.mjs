#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const eqDirectory = join(root, 'src/common/editor/parametric-eq');
const nativeDirectory = join(eqDirectory, 'native');
const manifestPath = join(eqDirectory, 'source-manifest.json');
const wasmPageBytes = 65_536;
const fixedMemoryBytes = 1_048_576;

export async function auditParametricEqWasm(options = {}) {
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
	const findings = [];
	validateManifest(manifest, findings);

	const expectedSources = new Set(manifest.sourceFiles.map((source) => source.path));
	const actualSources = listSourceFiles(nativeDirectory)
		.map((path) => relative(nativeDirectory, path));
	for (const path of actualSources) {
		if (!expectedSources.has(path)) {
			findings.push(`Unexpected native source outside the allowlist: ${path}`);
		}
	}
	for (const source of manifest.sourceFiles) {
		const path = join(nativeDirectory, source.path);
		let bytes;
		try {
			bytes = readFileSync(path);
		} catch {
			findings.push(`Missing pinned source: ${source.path}`);
			continue;
		}
		const hash = sha256(bytes);
		if (hash !== source.sha256) {
			findings.push(`Source hash mismatch for ${source.path}: ${hash}`);
		}
		if (manifest.compiledSources.includes(source.path)) {
			const text = bytes.toString('utf8');
			for (const token of manifest.forbiddenRuntimeTokens) {
				if (text.includes(token)) {
					findings.push(`Forbidden allocation/runtime token ${JSON.stringify(token)} in ${source.path}`);
				}
			}
		}
	}
	for (const compiledSource of manifest.compiledSources) {
		if (!expectedSources.has(compiledSource)) {
			findings.push(`Compiled source is not pinned: ${compiledSource}`);
		}
	}

	const expectedLocalExtensions = new Set(
		manifest.localExtensions.map((extension) => extension.path),
	);
	const actualLocalExtensions = readdirSync(eqDirectory, { withFileTypes: true })
		.filter((entry) => entry.isFile() && extname(entry.name) === '.js')
		.map((entry) => entry.name)
		.sort();
	for (const path of actualLocalExtensions) {
		if (!expectedLocalExtensions.has(path)) {
			findings.push(`Unexpected local EQ extension outside the allowlist: ${path}`);
		}
	}
	for (const extension of manifest.localExtensions) {
		let bytes;
		try {
			bytes = readFileSync(join(eqDirectory, extension.path));
		} catch {
			findings.push(`Missing pinned local EQ extension: ${extension.path}`);
			continue;
		}
		const hash = sha256(bytes);
		if (hash !== extension.sha256) {
			findings.push(`Local EQ extension hash mismatch for ${extension.path}: ${hash}`);
		}
	}
	for (const license of manifest.licenseFiles) {
		try {
			const hash = sha256(readFileSync(join(eqDirectory, license.path)));
			if (hash !== license.sha256) {
				findings.push(`Notice/license hash mismatch for ${license.path}: ${hash}`);
			}
		} catch {
			findings.push(`Missing pinned notice/license: ${license.path}`);
		}
	}

	let wasm = null;
	if (!options.sourcesOnly) {
		const wasmPath = join(eqDirectory, manifest.wasm.path);
		try {
			wasm = readFileSync(wasmPath);
		} catch {
			findings.push(`Missing parametric EQ artifact: ${relative(root, wasmPath)}`);
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
	if (manifest.schemaVersion !== 1) {
		findings.push(`Unsupported source-manifest schema: ${manifest.schemaVersion}`);
	}
	if (manifest.signalsmith?.revision !== '2d20161915e733f117545c6be8cd3275a739a1e3'
		|| manifest.signalsmith?.tag !== 'v1.7.1'
		|| manifest.signalsmith?.license !== 'MIT') {
		findings.push('Signalsmith DSP must remain pinned to MIT v1.7.1 commit 2d20161915e733f117545c6be8cd3275a739a1e3.');
	}
	if (manifest.toolchain?.emscriptenVersion !== '3.1.64') {
		findings.push('Parametric EQ WASM must remain pinned to Emscripten 3.1.64.');
	}
	if (!Array.isArray(manifest.localExtensions) || manifest.localExtensions.length === 0) {
		findings.push('Parametric EQ manifest must pin repository-owned local extensions.');
	}
	for (const name of ['initialMemoryBytes', 'maximumMemoryBytes']) {
		const value = manifest.wasm?.[name];
		if (!Number.isSafeInteger(value) || value <= 0 || value % wasmPageBytes !== 0) {
			findings.push(`wasm.${name} must be a positive multiple of ${wasmPageBytes} bytes.`);
		}
	}
	if (manifest.wasm?.initialMemoryBytes !== fixedMemoryBytes
		|| manifest.wasm?.maximumMemoryBytes !== fixedMemoryBytes) {
		findings.push('Parametric EQ manifest must enforce exactly 1 MiB of fixed linear memory.');
	}
}

function auditArtifactBytes(wasmPath, wasm, manifest, findings) {
	if (statSync(wasmPath).size > manifest.wasm.maximumBytes) {
		findings.push(`Parametric EQ artifact exceeds ${manifest.wasm.maximumBytes} bytes.`);
	}
	const hash = sha256(wasm);
	if (!manifest.wasm.sha256) {
		findings.push('Parametric EQ artifact hash is not pinned in source-manifest.json.');
	} else if (hash !== manifest.wasm.sha256) {
		findings.push(`Parametric EQ artifact hash mismatch: ${hash}`);
	}
	if (wasm.includes(Buffer.from(root))) {
		findings.push('The parametric EQ artifact embeds the local checkout path.');
	}
	try {
		const memoryLimits = readDefinedMemoryLimits(wasm);
		if (memoryLimits.length !== 1) {
			findings.push(`Expected exactly one defined WASM memory, found ${memoryLimits.length}.`);
		} else {
			const [memory] = memoryLimits;
			if (memory.memory64) findings.push('Parametric EQ artifact unexpectedly uses memory64.');
			if (memory.shared) findings.push('Parametric EQ artifact unexpectedly uses shared memory.');
			if (memory.minimumPages * wasmPageBytes !== manifest.wasm.initialMemoryBytes) {
				findings.push(`Initial linear memory is ${memory.minimumPages * wasmPageBytes} bytes; expected ${manifest.wasm.initialMemoryBytes}.`);
			}
			if (memory.maximumPages == null) {
				findings.push('Parametric EQ artifact has no declared maximum linear memory.');
			} else if (memory.maximumPages * wasmPageBytes !== manifest.wasm.maximumMemoryBytes) {
				findings.push(`Maximum linear memory is ${memory.maximumPages * wasmPageBytes} bytes; expected ${manifest.wasm.maximumMemoryBytes}.`);
			}
		}
	} catch (error) {
		findings.push(`Could not audit parametric EQ linear-memory limits: ${error.message}`);
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
	const importObject = {};
	for (const descriptor of WebAssembly.Module.imports(module)) {
		const key = `${descriptor.module}.${descriptor.name}`;
		if (descriptor.kind !== 'function' || !allowedImports.has(key)) {
			findings.push(`Forbidden WASM import: ${descriptor.kind} ${key}`);
		}
		importObject[descriptor.module] ||= {};
		importObject[descriptor.module][descriptor.name] = () => 0;
	}
	const exports = new Set(
		WebAssembly.Module.exports(module).map((descriptor) => descriptor.name),
	);
	for (const name of manifest.wasm.requiredExports) {
		if (!exports.has(name) && !exports.has(`_${name}`)) {
			findings.push(`Missing WASM export: ${name}`);
		}
	}
	if (findings.some((finding) => finding.startsWith('Forbidden WASM import:'))) {
		return;
	}
	try {
		const instance = await WebAssembly.instantiate(module, importObject);
		const api = instance.exports;
		const exported = (name) => api[name] || api[`_${name}`];
		exported('_initialize')?.();
		if (exported('peq_abi_version')() !== 2
			|| exported('peq_maximum_block_size')() !== 1024
			|| exported('peq_maximum_channels')() !== 32
			|| exported('peq_maximum_bands')() !== 12
			|| exported('peq_maximum_sections')() !== 48
			|| exported('peq_linear_memory_bytes')() !== fixedMemoryBytes) {
			findings.push('Parametric EQ artifact reports unexpected ABI limits.');
			return;
		}
		if (api.memory.buffer.byteLength !== fixedMemoryBytes) {
			findings.push(`Instantiated linear memory is ${api.memory.buffer.byteLength} bytes; expected ${fixedMemoryBytes}.`);
			return;
		}
		runtimeSmokeTest(api, exported, findings);
	} catch (error) {
		findings.push(`Parametric EQ ABI smoke test failed: ${error.message}`);
	}
}

function runtimeSmokeTest(api, exported, findings) {
	if (exported('peq_initialize')(48_000, 2) !== 0
		|| exported('peq_begin_configuration')(0, 0, 0) !== 0) {
		findings.push('Parametric EQ ABI could not initialize an identity configuration.');
		return;
	}
	const stagingResponse = exported('peq_response_db')(1, 1_000);
	if (!Number.isFinite(stagingResponse) || Math.abs(stagingResponse) > 1e-12
		|| exported('peq_commit_configuration')(0, 0) !== 0) {
		findings.push('Parametric EQ identity response/configuration is invalid.');
		return;
	}
	const frames = 8;
	const expected = [0, 0.25, -0.5, 1, -1, 0.125, -0.25, 0.75];
	for (let channel = 0; channel < 2; channel += 1) {
		const inputPointer = exported('peq_input_pointer')(channel);
		const outputPointer = exported('peq_output_pointer')(channel);
		if (inputPointer < 0 || outputPointer < 0
			|| inputPointer + 4 * 1024 > api.memory.buffer.byteLength
			|| outputPointer + 4 * 1024 > api.memory.buffer.byteLength) {
			findings.push('Parametric EQ planar buffer pointer is outside fixed memory.');
			return;
		}
		new Float32Array(api.memory.buffer, inputPointer, frames).set(
			expected.map((value) => channel === 0 ? value : -value),
		);
	}
	if (exported('peq_process')(frames) !== frames) {
		findings.push('Parametric EQ identity block did not process successfully.');
		return;
	}
	for (let channel = 0; channel < 2; channel += 1) {
		const output = new Float32Array(
			api.memory.buffer,
			exported('peq_output_pointer')(channel),
			frames,
		);
		const reference = Float32Array.from(
			expected,
			(value) => channel === 0 ? value : -value,
		);
		for (let frame = 0; frame < frames; frame += 1) {
			if (!Object.is(output[frame], reference[frame])) {
				findings.push(`Parametric EQ identity mismatch at channel ${channel}, frame ${frame}.`);
				return;
			}
		}
	}
	if (exported('peq_begin_semantic_configuration')(1, 0) !== 0
		|| exported('peq_set_semantic_band')(0, 0, 12, 1_000, 6, 1, 1) !== 0
		|| exported('peq_commit_configuration')(2, 32) !== 0
		|| exported('peq_is_transitioning')() !== 1) {
		findings.push('Parametric EQ structural transition ABI is invalid.');
		return;
	}
	for (let channel = 0; channel < 2; channel += 1) {
		new Float32Array(
			api.memory.buffer,
			exported('peq_input_pointer')(channel),
			32,
		).fill(0);
	}
	new Float32Array(api.memory.buffer, exported('peq_input_pointer')(0), 32)[0] = 1;
	if (exported('peq_process')(32) !== 32
		|| exported('peq_is_transitioning')() !== 0
		|| !Number.isFinite(exported('peq_response_db')(0, 1_000))) {
		findings.push('Parametric EQ structural transition did not complete safely.');
	}
}

function readDefinedMemoryLimits(wasm) {
	if (wasm.byteLength < 8
		|| wasm.readUInt32LE(0) !== 0x6d736100
		|| wasm.readUInt32LE(4) !== 1) {
		throw new Error('invalid WebAssembly header');
	}
	const limits = [];
	let offset = 8;
	while (offset < wasm.byteLength) {
		const sectionId = wasm[offset];
		offset += 1;
		const sectionSize = readUnsignedLeb(wasm, offset);
		offset = sectionSize.nextOffset;
		const sectionEnd = offset + sectionSize.value;
		if (sectionEnd > wasm.byteLength) {
			throw new Error('section extends beyond the artifact');
		}
		if (sectionId === 5) {
			const count = readUnsignedLeb(wasm, offset);
			offset = count.nextOffset;
			for (let index = 0; index < count.value; index += 1) {
				const flags = readUnsignedLeb(wasm, offset);
				offset = flags.nextOffset;
				const memory64 = Boolean(flags.value & 0x04);
				if (memory64) throw new Error('memory64 limits are not supported by this audit');
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
		const byte = bytes[offset];
		offset += 1;
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
		else if (['.c', '.cc', '.cpp', '.h', '.hpp'].includes(extname(entry.name))) {
			result.push(path);
		}
	}
	return result.sort();
}

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}

const isMain = process.argv[1]
	&& resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	const result = await auditParametricEqWasm({
		sourcesOnly: process.argv.includes('--sources-only'),
	});
	if (process.argv.includes('--json')) {
		process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
	} else if (result.ok) {
		process.stdout.write(
			`Parametric EQ audit passed (${result.sourceCount} pinned native sources, ${result.localExtensionCount} local extensions${result.wasmBytes == null ? '' : `, ${result.wasmBytes} WASM bytes`}).\n`,
		);
	} else {
		process.stderr.write(`${result.findings.map((finding) => `- ${finding}`).join('\n')}\n`);
	}
	if (!result.ok) process.exitCode = 1;
}

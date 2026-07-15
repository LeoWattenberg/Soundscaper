#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const nyquistDirectory = join(root, 'src/lib/tools/audio-editor/nyquist');
const manifestPath = join(nyquistDirectory, 'source-manifest.json');
const wasmPageBytes = 65_536;

export async function auditNyquistWasm(options = {}) {
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
	const findings = [];
	validateMemoryBudget(manifest.wasm, findings);
	validateLocalFiles(manifest, findings);
	validateSandboxAdaptation(findings);

	const audacitySource = options.audacitySource || process.env.AUDACITY_SOURCE_DIR;
	if (audacitySource) validateAudacitySource(resolve(audacitySource), manifest, findings);

	let wasm = null;
	if (!options.sourcesOnly) {
		const wasmPath = join(nyquistDirectory, manifest.wasm.path);
		try {
			wasm = readFileSync(wasmPath);
		} catch {
			findings.push(`Missing Nyquist artifact: ${relative(root, wasmPath)}`);
		}
		if (wasm) await validateWasm(wasm, wasmPath, manifest, findings);
	}

	return {
		ok: findings.length === 0,
		findings,
		localSourceCount: manifest.localSources.length,
		wasmBytes: wasm?.byteLength ?? null,
		wasmSha256: wasm ? sha256(wasm) : null,
	};
}

function validateLocalFiles(manifest, findings) {
	for (const entry of [...manifest.localSources, ...(manifest.licenseFiles || [])]) {
		const path = join(nyquistDirectory, entry.path);
		try {
			const actual = sha256(readFileSync(path));
			if (actual !== entry.sha256) findings.push(`Hash mismatch for ${entry.path}: ${actual}`);
		} catch {
			findings.push(`Missing pinned file: ${entry.path}`);
		}
	}
	const runtimePaths = new Set(manifest.runtime.files.map((entry) => entry.path));
	for (const forbidden of ['aud-do-support.lsp', 'sample-data-import.ny', 'sample-data-export.ny']) {
		if (runtimePaths.has(forbidden)) findings.push(`Forbidden browser runtime resource: ${forbidden}`);
	}
}

function validateSandboxAdaptation(findings) {
	const patch = readFileSync(join(nyquistDirectory, 'native/patches/nyx-browser.patch'), 'utf8');
	const bridge = readFileSync(join(nyquistDirectory, 'native/nyquist_wasm.c'), 'utf8');
	const stubs = readFileSync(join(nyquistDirectory, 'native/nyquist_io_stubs.c'), 'utf8');
	for (const marker of [
		'return nyquist_runtime_open(name, mode);',
		'return cvstring("/runtime/");',
		'return FALSE;',
		'return cvstring("browser");',
	]) {
		if (!patch.includes(marker)) findings.push(`Browser sandbox patch is missing ${JSON.stringify(marker)}.`);
	}
	for (const marker of [
		'Sound-file input is disabled in the browser',
		'Sound-file output is disabled in the browser',
	]) {
		if (!stubs.includes(marker)) findings.push(`Browser I/O stubs are missing ${JSON.stringify(marker)}.`);
	}
	for (const marker of ['NYQ_MAX_SOURCE_BYTES', 'NYQ_MAX_OUTPUT_BYTES', 'render_truncated']) {
		if (!bridge.includes(marker)) findings.push(`Bounded Nyquist ABI is missing ${marker}.`);
	}
}

async function validateWasm(wasm, wasmPath, manifest, findings) {
	const size = statSync(wasmPath).size;
	const hash = sha256(wasm);
	if (size > manifest.wasm.maximumBytes) findings.push(`Nyquist artifact exceeds ${manifest.wasm.maximumBytes} bytes.`);
	if (!manifest.wasm.sha256) findings.push('Nyquist artifact hash is not pinned.');
	else if (hash !== manifest.wasm.sha256) findings.push(`Nyquist artifact hash mismatch: ${hash}`);
	for (const token of manifest.forbiddenArtifactTokens || []) {
		if (wasm.includes(Buffer.from(token))) findings.push(`Forbidden token ${JSON.stringify(token)} is embedded in Nyquist WASM.`);
	}
	if (wasm.includes(Buffer.from(root)) || wasm.includes(Buffer.from('/tmp/soundscaper-'))) {
		findings.push('Nyquist WASM embeds a local build path.');
	}

	try {
		const limits = readDefinedMemoryLimits(wasm);
		if (limits.length !== 1) findings.push(`Expected one defined WASM memory, found ${limits.length}.`);
		else {
			const [memory] = limits;
			if (memory.shared) findings.push('Nyquist WASM unexpectedly uses shared memory.');
			if (memory.memory64) findings.push('Nyquist WASM unexpectedly uses memory64.');
			if (memory.minimumPages * wasmPageBytes !== manifest.wasm.initialMemoryBytes) {
				findings.push(`Nyquist initial memory is ${memory.minimumPages * wasmPageBytes} bytes.`);
			}
			if (memory.maximumPages == null) findings.push('Nyquist WASM has no declared maximum memory.');
			else if (memory.maximumPages * wasmPageBytes !== manifest.wasm.maximumMemoryBytes) {
				findings.push(`Nyquist maximum memory is ${memory.maximumPages * wasmPageBytes} bytes.`);
			}
		}
	} catch (error) {
		findings.push(`Could not audit Nyquist memory limits: ${error.message}`);
	}

	try {
		const module = await WebAssembly.compile(wasm);
		const allowedImports = new Set(manifest.wasm.allowedFunctionImports);
		const actualImports = new Set();
		for (const descriptor of WebAssembly.Module.imports(module)) {
			const key = `${descriptor.module}.${descriptor.name}`;
			actualImports.add(key);
			if (descriptor.kind !== 'function' || !allowedImports.has(key)) {
				findings.push(`Forbidden WASM import: ${descriptor.kind} ${key}`);
			}
		}
		for (const key of allowedImports) {
			if (!actualImports.has(key)) findings.push(`Pinned WASM import is absent: ${key}`);
		}
		const exports = new Set(WebAssembly.Module.exports(module).map((entry) => entry.name));
		for (const name of manifest.wasm.requiredExports) {
			if (!exports.has(name) && !exports.has(`_${name}`)) findings.push(`Missing WASM export: ${name}`);
		}
	} catch (error) {
		findings.push(`Invalid WebAssembly artifact: ${error.message}`);
	}
}

function validateAudacitySource(audacityRoot, manifest, findings) {
	const libnyquist = join(audacityRoot, 'lib-src/libnyquist');
	if (!existsSync(libnyquist)) {
		findings.push(`Audacity source does not contain lib-src/libnyquist: ${audacityRoot}`);
		return;
	}
	const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: audacityRoot, encoding: 'utf8' });
	if (revision.status !== 0 || revision.stdout.trim() !== manifest.audacity.revision) {
		findings.push(`Audacity source is not revision ${manifest.audacity.revision}.`);
		return;
	}
	try {
		const cmake = readFileSync(join(libnyquist, 'CMakeLists.txt'), 'utf8');
		const sources = parseCmakeSources(cmake).sort();
		const hash = createHash('sha256');
		for (const source of sources) {
			hash.update(`${source}\0`);
			hash.update(readFileSync(join(libnyquist, source)));
		}
		for (const entry of manifest.runtime.files) {
			if (['init.lsp', 'nyinit.lsp', 'system.lsp'].includes(entry.path)) continue;
			hash.update(`runtime/${entry.path}\0`);
			hash.update(readFileSync(join(audacityRoot, 'nyquist', entry.path)));
		}
		const actual = hash.digest('hex');
		if (actual !== manifest.audacity.sourceTreeSha256) {
			findings.push(`Audacity Nyquist source-tree hash mismatch: ${actual}`);
		}
	} catch (error) {
		findings.push(`Could not audit Audacity Nyquist sources: ${error.message}`);
	}
}

function parseCmakeSources(source) {
	const block = source.match(/set\( SOURCES([\s\S]*?)\n\)/)?.[1];
	if (!block) throw new Error('could not parse CMake source list');
	return block.split('\n')
		.map((line) => line.replace(/#.*/, '').trim())
		.filter((line) => line && line !== 'PRIVATE');
}

function validateMemoryBudget(wasm, findings) {
	for (const name of ['initialMemoryBytes', 'maximumMemoryBytes']) {
		const value = wasm[name];
		if (!Number.isSafeInteger(value) || value <= 0 || value % wasmPageBytes !== 0) {
			findings.push(`wasm.${name} must be a positive multiple of ${wasmPageBytes}.`);
		}
	}
	if (wasm.initialMemoryBytes > wasm.maximumMemoryBytes) findings.push('Nyquist initial memory exceeds maximum memory.');
	if (wasm.maximumMemoryBytes !== 256 * 1024 * 1024) findings.push('Nyquist maximum memory must be exactly 256 MiB.');
}

function readDefinedMemoryLimits(wasm) {
	if (wasm.byteLength < 8 || wasm.readUInt32LE(0) !== 0x6d736100 || wasm.readUInt32LE(4) !== 1) {
		throw new Error('invalid WebAssembly header');
	}
	const result = [];
	let offset = 8;
	while (offset < wasm.byteLength) {
		const sectionId = wasm[offset++];
		const sectionSize = readUnsignedLeb(wasm, offset);
		offset = sectionSize.nextOffset;
		const end = offset + sectionSize.value;
		if (end > wasm.byteLength) throw new Error('section extends beyond artifact');
		if (sectionId === 5) {
			const count = readUnsignedLeb(wasm, offset);
			offset = count.nextOffset;
			for (let index = 0; index < count.value; index += 1) {
				const flags = readUnsignedLeb(wasm, offset);
				offset = flags.nextOffset;
				const minimum = readUnsignedLeb(wasm, offset);
				offset = minimum.nextOffset;
				let maximumPages = null;
				if (flags.value & 1) {
					const maximum = readUnsignedLeb(wasm, offset);
					offset = maximum.nextOffset;
					maximumPages = maximum.value;
				}
				result.push({
					minimumPages: minimum.value,
					maximumPages,
					shared: Boolean(flags.value & 2),
					memory64: Boolean(flags.value & 4),
				});
			}
		}
		offset = end;
	}
	return result;
}

function readUnsignedLeb(bytes, start) {
	let value = 0;
	let multiplier = 1;
	let offset = start;
	for (let index = 0; index < 5; index += 1) {
		if (offset >= bytes.byteLength) throw new Error('truncated LEB128 value');
		const byte = bytes[offset++];
		value += (byte & 0x7f) * multiplier;
		if ((byte & 0x80) === 0) return { value, nextOffset: offset };
		multiplier *= 128;
	}
	throw new Error('LEB128 value exceeds 32 bits');
}

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	const sourceIndex = process.argv.indexOf('--audacity-source');
	const result = await auditNyquistWasm({
		sourcesOnly: process.argv.includes('--sources-only'),
		audacitySource: sourceIndex >= 0 ? process.argv[sourceIndex + 1] : undefined,
	});
	if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
	else if (result.ok) process.stdout.write(`Nyquist audit passed (${result.localSourceCount} pinned local sources${result.wasmBytes == null ? '' : `, ${result.wasmBytes} WASM bytes`}).\n`);
	else process.stderr.write(`${result.findings.map((finding) => `- ${finding}`).join('\n')}\n`);
	if (!result.ok) process.exitCode = 1;
}

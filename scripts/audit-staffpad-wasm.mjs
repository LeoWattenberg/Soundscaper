#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readStrictDefinedMemoryLimits as readDefinedMemoryLimits } from './lib/wasm-binary-inspection.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const staffpadDirectory = join(root, 'src/common/editor/staffpad');
const nativeDirectory = join(staffpadDirectory, 'native');
const manifestPath = join(staffpadDirectory, 'source-manifest.json');
const wasmPageBytes = 65_536;
const maximumStaffPadMemoryBytes = 64 * 1024 * 1024;

export async function auditStaffPadWasm(options = {}) {
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
	const findings = [];
	validateMemoryBudget(manifest.wasm, findings);
	const expectedFiles = new Set(manifest.sourceFiles.map((source) => source.path));
	const actualFiles = listSourceFiles(nativeDirectory).map((path) => relative(nativeDirectory, path));
	for (const path of actualFiles) {
		if (!expectedFiles.has(path)) findings.push(`Unexpected native source outside the allowlist: ${path}`);
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
		if (hash !== source.sha256) findings.push(`Source hash mismatch for ${source.path}: ${hash}`);
		const text = bytes.toString('utf8');
		for (const token of manifest.forbiddenSourceTokens) {
			if (text.includes(token)) findings.push(`Forbidden source token ${JSON.stringify(token)} in ${source.path}`);
		}
	}
	for (const compiledSource of manifest.compiledSources) {
		if (!expectedFiles.has(compiledSource)) findings.push(`Compiled source is not pinned: ${compiledSource}`);
	}
	for (const license of manifest.licenseFiles || []) {
		try {
			const hash = sha256(readFileSync(join(staffpadDirectory, license.path)));
			if (hash !== license.sha256) findings.push(`License hash mismatch for ${license.path}: ${hash}`);
		} catch {
			findings.push(`Missing pinned license: ${license.path}`);
		}
	}

	let wasm = null;
	if (!options.sourcesOnly) {
		const wasmPath = join(staffpadDirectory, manifest.wasm.path);
		try {
			wasm = readFileSync(wasmPath);
		} catch {
			findings.push(`Missing StaffPad artifact: ${relative(root, wasmPath)}`);
		}
		if (wasm) {
			const size = statSync(wasmPath).size;
			const hash = sha256(wasm);
			if (size > manifest.wasm.maximumBytes) findings.push(`StaffPad artifact exceeds ${manifest.wasm.maximumBytes} bytes.`);
			if (!manifest.wasm.sha256) findings.push('StaffPad artifact hash is not pinned in source-manifest.json.');
			else if (hash !== manifest.wasm.sha256) findings.push(`StaffPad artifact hash mismatch: ${hash}`);
			for (const token of manifest.forbiddenSourceTokens) {
				if (wasm.includes(Buffer.from(token))) findings.push(`Forbidden token ${JSON.stringify(token)} is embedded in the artifact.`);
			}
			if (wasm.includes(Buffer.from(root))) findings.push('The artifact embeds the local checkout path.');
			try {
				const memoryLimits = readDefinedMemoryLimits(wasm);
				if (memoryLimits.length !== 1) {
					findings.push(`Expected exactly one defined WASM memory, found ${memoryLimits.length}.`);
				} else {
					const [memory] = memoryLimits;
					if (memory.memory64) findings.push('StaffPad artifact unexpectedly uses memory64.');
					if (memory.shared) findings.push('StaffPad artifact unexpectedly uses shared memory.');
					if (memory.minimumPages * wasmPageBytes !== manifest.wasm.initialMemoryBytes) {
						findings.push(`StaffPad initial linear memory is ${memory.minimumPages * wasmPageBytes} bytes; expected ${manifest.wasm.initialMemoryBytes}.`);
					}
					if (memory.maximumPages == null) {
						findings.push('StaffPad artifact has no declared maximum linear memory.');
					} else if (memory.maximumPages * wasmPageBytes !== manifest.wasm.maximumMemoryBytes) {
						findings.push(`StaffPad maximum linear memory is ${memory.maximumPages * wasmPageBytes} bytes; expected ${manifest.wasm.maximumMemoryBytes}.`);
					}
				}
			} catch (error) {
				findings.push(`Could not audit StaffPad linear-memory limits: ${error.message}`);
			}
			try {
				const module = await WebAssembly.compile(wasm);
				const allowedImports = new Set(manifest.wasm.allowedFunctionImports);
				for (const descriptor of WebAssembly.Module.imports(module)) {
					const key = `${descriptor.module}.${descriptor.name}`;
					if (descriptor.kind !== 'function' || !allowedImports.has(key)) {
						findings.push(`Forbidden WASM import: ${descriptor.kind} ${key}`);
					}
				}
				const exports = new Set(WebAssembly.Module.exports(module).map((descriptor) => descriptor.name));
				for (const name of manifest.wasm.requiredExports) {
					if (!exports.has(name) && !exports.has(`_${name}`)) findings.push(`Missing WASM export: ${name}`);
				}
			} catch (error) {
				findings.push(`Invalid WebAssembly artifact: ${error.message}`);
			}
		}
	}

	return {
		ok: findings.length === 0,
		findings,
		sourceCount: manifest.sourceFiles.length,
		wasmBytes: wasm?.byteLength ?? null,
		wasmSha256: wasm ? sha256(wasm) : null,
	};
}

function validateMemoryBudget(wasmManifest, findings) {
	for (const name of ['initialMemoryBytes', 'maximumMemoryBytes']) {
		const value = wasmManifest[name];
		if (!Number.isSafeInteger(value) || value <= 0 || value % wasmPageBytes !== 0) {
			findings.push(`wasm.${name} must be a positive multiple of ${wasmPageBytes} bytes.`);
		}
	}
	if (wasmManifest.initialMemoryBytes > wasmManifest.maximumMemoryBytes) {
		findings.push('wasm.initialMemoryBytes exceeds wasm.maximumMemoryBytes.');
	}
	if (wasmManifest.maximumMemoryBytes !== maximumStaffPadMemoryBytes) {
		findings.push(`StaffPad manifest must enforce a 64 MiB maximum linear-memory budget (${maximumStaffPadMemoryBytes} bytes).`);
	}
}

function listSourceFiles(directory) {
	const result = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) result.push(...listSourceFiles(path));
		else if (['.c', '.cc', '.cpp', '.h', '.hpp'].includes(extname(entry.name))) result.push(path);
	}
	return result.sort();
}

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	const result = await auditStaffPadWasm({ sourcesOnly: process.argv.includes('--sources-only') });
	if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
	else if (result.ok) process.stdout.write(`StaffPad audit passed (${result.sourceCount} pinned sources${result.wasmBytes == null ? '' : `, ${result.wasmBytes} WASM bytes`}).\n`);
	else process.stderr.write(`${result.findings.map((finding) => `- ${finding}`).join('\n')}\n`);
	if (!result.ok) process.exitCode = 1;
}

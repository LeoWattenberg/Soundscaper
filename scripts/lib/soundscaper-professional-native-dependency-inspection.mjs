/* SPDX-License-Identifier: AGPL-3.0-only */

/** Recursive dependency, RPATH, and binary-architecture closure admission. */

import { spawnSync } from 'node:child_process';
import { basename } from 'node:path';

import { isSoundscaperProfessionalLinuxRuntimeLibrary } from
'../../desktop/soundscaper-professional-linux-system-libraries.ts';

import {
	assertSoundscaperNativeBinaryArchitecture,
	inspectSoundscaperNativeBinaryFile,
	validateSoundscaperNativeBinaryArchitectureReceipt,
} from './soundscaper-native-binary-architecture.mjs';
import {
	canonicalRegularFile,
	resolveCandidatePath,
	soundscaperProfessionalNativeCandidateArtifactPaths,
} from './soundscaper-professional-native-candidate-contract.mjs';

const MAXIMUM_OUTPUT_BYTES = 1024 * 1024;
const WINDOWS_SYSTEM_LIBRARIES = new Set([
	'advapi32.dll', 'api-ms-win-shcore-scaling-l1-1-1.dll', 'avrt.dll', 'bcrypt.dll', 'cfgmgr32.dll', 'comctl32.dll',
	'comdlg32.dll', 'd2d1.dll', 'd3d11.dll', 'dcomp.dll', 'dwrite.dll', 'dwmapi.dll',
	'dxgi.dll', 'gdi32.dll', 'imm32.dll', 'kernel32.dll', 'mf.dll', 'mfplat.dll',
	'mfreadwrite.dll', 'mfuuid.dll', 'ole32.dll', 'oleaut32.dll', 'powrprof.dll',
	'propsys.dll', 'rpcrt4.dll', 'secur32.dll', 'setupapi.dll', 'shell32.dll',
	'shcore.dll', 'shlwapi.dll', 'user32.dll', 'userenv.dll', 'uuid.dll', 'version.dll', 'vfw32.dll',
	'wininet.dll', 'winmm.dll', 'ws2_32.dll',
]);

export async function validateSoundscaperProfessionalNativeDependencyClosure({
	target, artifacts, runtimeArtifacts, root, inspectDependencies,
}) {
	const byBasename = new Map(runtimeArtifacts.map((entry) =>
		[basename(entry.path).toLowerCase(), entry]));
	const inspections = [];
	for (const artifact of artifacts) {
		const inspected = await inspectDependencies({
			target, path: artifact.absolutePath ?? resolveCandidatePath(root, artifact.path),
		});
		const imports = inspected?.imports;
		const rpaths = inspected?.rpaths;
		const architecture = inspected?.architecture;
		if (!Array.isArray(imports)
			|| imports.some((value) => typeof value !== 'string' || value === '')) {
			throw new TypeError('The native dependency inspector returned an invalid import list.');
		}
		if (!Array.isArray(rpaths)
			|| rpaths.some((value) => typeof value !== 'string' || value === '')) {
			throw new TypeError('The native dependency inspector returned an invalid RPATH list.');
		}
		validateSoundscaperNativeBinaryArchitectureReceipt(architecture, target);
		validateRpaths(target, artifact.path, rpaths);
		for (const imported of imports) {
			if (target.startsWith('linux-') && imported.replaceAll('\\', '/').includes('/')) {
				throw new Error(`${artifact.path} has ambient runtime dependency ${imported}.`);
			}
			if (systemLibrary(target, imported)) continue;
			if (ambientDependency(imported)) {
				throw new Error(`${artifact.path} has ambient runtime dependency ${imported}.`);
			}
			const name = basename(imported.replaceAll('\\', '/')).toLowerCase();
			if (!byBasename.has(name)) {
				throw new Error(`${artifact.path} has undeclared runtime dependency ${imported}.`);
			}
		}
		inspections.push(Object.freeze({
			artifactPath: artifact.path, architecture,
			imports: Object.freeze([...imports].sort()),
			rpaths: Object.freeze([...rpaths].sort()),
		}));
	}
	return Object.freeze(inspections.sort((left, right) => left.artifactPath === right.artifactPath
		? 0 : left.artifactPath < right.artifactPath ? -1 : 1));
}

export async function inspectSoundscaperProfessionalNativeDependencies({ target, path }) {
	if (target.startsWith('win-')) {
		const bytes = await canonicalRegularFile(path, 'Windows dependency-inspection input');
		return {
			architecture: assertSoundscaperNativeBinaryArchitecture(bytes, target),
			imports: portableExecutableImports(bytes),
			rpaths: [],
		};
	}
	const architecture = await inspectSoundscaperNativeBinaryFile({ path, target });
	const [command, args] = target.startsWith('linux-') ? ['readelf', ['--dynamic', path]]
		: ['otool', ['-L', path]];
	const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: MAXIMUM_OUTPUT_BYTES });
	if (result.status !== 0) {
		throw new Error(`Dependency inspection failed for ${basename(path)}: ${result.stderr || result.stdout || command}.`);
	}
	if (target.startsWith('linux-')) return {
		architecture,
		...parseSoundscaperProfessionalLinuxDynamicSection(result.stdout),
	};
	if (target === 'mac-arm64') {
		const rpathResult = spawnSync('otool', ['-l', path], {
			encoding: 'utf8', maxBuffer: MAXIMUM_OUTPUT_BYTES,
		});
		if (rpathResult.status !== 0) throw new Error(`RPATH inspection failed for ${basename(path)}.`);
		return {
			architecture,
			imports: result.stdout.split(/\r?\n/u).slice(1)
				.map((line) => line.trim().split(/\s+/u)[0]).filter(Boolean),
			rpaths: [...rpathResult.stdout.matchAll(/\bpath ([^\s]+) \(offset/gu)]
				.map((match) => match[1]),
		};
	}
	throw new TypeError(`The native dependency target ${String(target)} is unsupported.`);
}

export function parseSoundscaperProfessionalLinuxDynamicSection(value) {
	if (typeof value !== 'string') throw new TypeError('The Linux dynamic section must be text.');
	return Object.freeze({
		imports: Object.freeze([...value.matchAll(/Shared library: \[([^\]]+)\]/gu)]
			.map((match) => match[1])),
		rpaths: Object.freeze([...value.matchAll(
			/\((?:RPATH|RUNPATH)\).*Library (?:rpath|runpath): \[([^\]]+)\]/gu,
		)].flatMap((match) => match[1].split(':')).filter(Boolean)),
	});
}

function portableExecutableImports(value) {
	const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
	if (bytes.byteLength < 256 || bytes.subarray(0, 2).toString('ascii') !== 'MZ') {
		throw new TypeError('The PE dependency table is malformed.');
	}
	const peOffset = bytes.readUInt32LE(0x3c);
	requireRange(bytes, peOffset, 24, 'PE header');
	if (bytes.subarray(peOffset, peOffset + 4).toString('binary') !== 'PE\0\0') {
		throw new TypeError('The PE dependency table is malformed.');
	}
	const sectionCount = bytes.readUInt16LE(peOffset + 6);
	const optionalBytes = bytes.readUInt16LE(peOffset + 20);
	const optionalOffset = peOffset + 24;
	if (sectionCount < 1 || sectionCount > 96 || optionalBytes < 240) {
		throw new TypeError('The PE dependency-table dimensions are invalid.');
	}
	requireRange(bytes, optionalOffset, optionalBytes + sectionCount * 40,
		'PE optional header and sections');
	if (bytes.readUInt16LE(optionalOffset) !== 0x20b
		|| bytes.readUInt32LE(optionalOffset + 108) < 16) {
		throw new TypeError('The PE32+ dependency directories are incomplete.');
	}
	const sections = [];
	const sectionOffset = optionalOffset + optionalBytes;
	for (let index = 0; index < sectionCount; index += 1) {
		const offset = sectionOffset + index * 40;
		sections.push({
			virtualSize: bytes.readUInt32LE(offset + 8),
			virtualAddress: bytes.readUInt32LE(offset + 12),
			rawSize: bytes.readUInt32LE(offset + 16),
			rawOffset: bytes.readUInt32LE(offset + 20),
		});
	}
	const sizeOfHeaders = bytes.readUInt32LE(optionalOffset + 60);
	const rvaOffset = (rva, length, label) => {
		if (rva < sizeOfHeaders) {
			requireRange(bytes, rva, length, label);
			return rva;
		}
		for (const section of sections) {
			const span = Math.max(section.virtualSize, section.rawSize);
			const delta = rva - section.virtualAddress;
			if (delta < 0 || delta >= span || delta + length > section.rawSize) continue;
			const offset = section.rawOffset + delta;
			requireRange(bytes, offset, length, label);
			return offset;
		}
		throw new TypeError(`The ${label} RVA is outside the PE image.`);
	};
	const imports = descriptorImports(bytes, optionalOffset, rvaOffset, 1, 20, 12, false);
	const delayed = descriptorImports(bytes, optionalOffset, rvaOffset, 13, 32, 4, true);
	return [...new Set([...imports, ...delayed])];
}

function descriptorImports(bytes, optionalOffset, rvaOffset, directoryIndex,
	descriptorBytes, nameFieldOffset, requireRvaAttribute) {
	const directoryOffset = optionalOffset + 112 + directoryIndex * 8;
	const directoryRva = bytes.readUInt32LE(directoryOffset);
	const directoryBytes = bytes.readUInt32LE(directoryOffset + 4);
	if (directoryRva === 0 && directoryBytes === 0) return [];
	if (directoryRva === 0 || directoryBytes < descriptorBytes
		|| directoryBytes > descriptorBytes * 4097) {
		throw new TypeError('The PE import directory is malformed or unbounded.');
	}
	const start = rvaOffset(directoryRva, directoryBytes, 'PE import directory');
	const count = Math.floor(directoryBytes / descriptorBytes);
	const imports = [];
	let terminated = false;
	for (let index = 0; index < count; index += 1) {
		const offset = start + index * descriptorBytes;
		const fields = bytes.subarray(offset, offset + descriptorBytes);
		if (fields.every((byte) => byte === 0)) {
			terminated = true;
			break;
		}
		if (requireRvaAttribute && bytes.readUInt32LE(offset) !== 1) {
			throw new TypeError('The PE delay import name is not RVA-addressed.');
		}
		const nameRva = bytes.readUInt32LE(offset + nameFieldOffset);
		const nameOffset = rvaOffset(nameRva, 1, 'PE import name');
		imports.push(asciiDllName(bytes, nameOffset));
	}
	if (!terminated) throw new TypeError('The PE import directory has no terminator.');
	return imports;
}

function asciiDllName(bytes, offset) {
	const endLimit = Math.min(bytes.byteLength, offset + 260);
	let end = offset;
	while (end < endLimit && bytes[end] !== 0) end += 1;
	if (end === offset || end === endLimit) throw new TypeError('The PE import name is malformed.');
	const name = bytes.subarray(offset, end).toString('ascii');
	if (!/^[A-Za-z0-9._+-]+\.dll$/iu.test(name)) {
		throw new TypeError('The PE import name is not one portable DLL basename.');
	}
	return name;
}

function requireRange(bytes, offset, length, label) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length)
		|| offset < 0 || length < 0 || offset > bytes.byteLength - length) {
		throw new TypeError(`The ${label} exceeds the PE file bounds.`);
	}
}

function validateRpaths(target, artifactPath, rpaths) {
	const permitted = target.startsWith('linux-') ? '$ORIGIN/runtime'
		: target === 'mac-arm64' ? '@loader_path/runtime' : null;
	if (rpaths.some((entry) => entry !== permitted)
		|| (artifactPath === soundscaperProfessionalNativeCandidateArtifactPaths(target).pluginPeer
			&& permitted !== null && !rpaths.includes(permitted))) {
		throw new Error(`${artifactPath} has an unreviewed native RPATH.`);
	}
}

function ambientDependency(imported) {
	const normalized = imported.replaceAll('\\', '/');
	return normalized.startsWith('/') || /^[A-Za-z]:\//u.test(normalized)
		|| (normalized.includes('/') && !normalized.startsWith('@rpath/')
			&& !normalized.startsWith('@loader_path/runtime/'));
}

function systemLibrary(target, imported) {
	if (target === 'mac-arm64') {
		return imported.startsWith('/System/Library/') || imported.startsWith('/usr/lib/');
	}
	if (target.startsWith('linux-')) {
		return isSoundscaperProfessionalLinuxRuntimeLibrary(imported, target);
	}
	const name = basename(imported.replaceAll('\\', '/')).toLowerCase();
	return target.startsWith('win-') && WINDOWS_SYSTEM_LIBRARIES.has(name);
}

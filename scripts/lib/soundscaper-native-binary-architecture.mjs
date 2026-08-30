/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact on-disk architecture admission for professional native payloads. */

import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

const TARGETS = new Set([
	'linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64',
]);
const DEFAULT_MAXIMUM_BYTES = 512 * 1024 * 1024;
const MAXIMUM_HEADER_BYTES = 65_562;
const FAT_MAGICS = new Set([0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca]);

export function assertSoundscaperNativeBinaryArchitecture(value, targetValue) {
	const target = targetId(targetValue);
	const bytes = Buffer.isBuffer(value) ? value
		: ArrayBuffer.isView(value) ? Buffer.from(value.buffer, value.byteOffset, value.byteLength) : null;
	if (bytes !== null && bytes.byteLength >= 4 && FAT_MAGICS.has(bytes.readUInt32BE(0))) {
		throw new TypeError('Fat or universal Mach-O binaries are not admitted.');
	}
	if (bytes === null || bytes.byteLength < 12) {
		throw new TypeError('The native binary header is malformed.');
	}
	const observed = bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
		? elfArchitecture(bytes)
		: bytes.subarray(0, 2).toString('ascii') === 'MZ'
			? peArchitecture(bytes)
			: machArchitecture(bytes);
	const [platform, architecture] = target.split('-');
	const expectedFormat = platform === 'linux' ? 'elf64-le'
		: platform === 'win' ? 'pe32-plus' : 'mach-o-64-le';
	if (observed.format !== expectedFormat || observed.architecture !== architecture) {
		throw new Error(`The native binary is not target-native for ${target}.`);
	}
	return validateSoundscaperNativeBinaryArchitectureReceipt({
		schemaVersion: 1, target, ...observed,
	}, target);
}

export function validateSoundscaperNativeBinaryArchitectureReceipt(value, targetValue = value?.target) {
	const target = targetId(targetValue);
	const [platform, architecture] = target.split('-');
	const expected = platform === 'linux'
		? architecture === 'x64' ? ['elf64-le', 'EM_X86_64'] : ['elf64-le', 'EM_AARCH64']
		: platform === 'win'
			? architecture === 'x64' ? ['pe32-plus', 'IMAGE_FILE_MACHINE_AMD64']
				: ['pe32-plus', 'IMAGE_FILE_MACHINE_ARM64']
			: ['mach-o-64-le', 'CPU_TYPE_ARM64'];
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.keys(value).sort().join(',')
			!== 'architecture,format,machine,schemaVersion,target'
		|| value.schemaVersion !== 1 || value.target !== target
		|| value.architecture !== architecture || value.format !== expected[0]
		|| value.machine !== expected[1]) {
		throw new TypeError(`The native binary architecture receipt does not match ${target}.`);
	}
	return deepFreeze(value);
}

export async function inspectSoundscaperNativeBinaryFile(options) {
	const path = canonicalPath(options?.path);
	const target = targetId(options?.target);
	const maximumBytes = maximumByteLength(options?.maximumBytes);
	const before = await lstat(path);
	if (!before.isFile() || before.isSymbolicLink() || await realpath(path) !== path
		|| before.size < 12 || before.size > maximumBytes) {
		throw new Error('The native binary is not one bounded canonical regular file.');
	}
	const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	try {
		const opened = await handle.stat();
		if (!opened.isFile() || opened.size !== before.size
			|| (before.ino !== 0 && opened.ino !== 0
				&& (before.dev !== opened.dev || before.ino !== opened.ino))) {
			throw new Error('The native binary changed while opening.');
		}
		const header = Buffer.alloc(Math.min(opened.size, MAXIMUM_HEADER_BYTES));
		let offset = 0;
		while (offset < header.byteLength) {
			const { bytesRead } = await handle.read(header, offset, header.byteLength - offset, offset);
			if (bytesRead === 0) break;
			offset += bytesRead;
		}
		const after = await handle.stat();
		if (offset !== header.byteLength || after.size !== opened.size
			|| after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) {
			throw new Error('The native binary changed while reading its architecture.');
		}
		return assertSoundscaperNativeBinaryArchitecture(header, target);
	} finally { await handle.close(); }
}

function elfArchitecture(bytes) {
	if (bytes.byteLength < 20 || bytes[4] !== 2 || bytes[5] !== 1 || bytes[6] !== 1) {
		throw new TypeError('The ELF binary header is malformed or is not little-endian ELF64.');
	}
	const machine = bytes.readUInt16LE(18);
	if (machine === 62) return { format: 'elf64-le', architecture: 'x64', machine: 'EM_X86_64' };
	if (machine === 183) return { format: 'elf64-le', architecture: 'arm64', machine: 'EM_AARCH64' };
	throw new TypeError(`The ELF binary machine ${String(machine)} is unsupported.`);
}

function peArchitecture(bytes) {
	if (bytes.byteLength < 64) throw new TypeError('The PE binary header is malformed.');
	const peOffset = bytes.readUInt32LE(0x3c);
	if (peOffset < 64 || peOffset > 65_536 || peOffset + 26 > bytes.byteLength
		|| bytes.subarray(peOffset, peOffset + 4).toString('binary') !== 'PE\0\0') {
		throw new TypeError('The PE binary header is malformed.');
	}
	if (bytes.readUInt16LE(peOffset + 24) !== 0x20b) {
		throw new TypeError('The Windows native binary is not PE32+.');
	}
	const machine = bytes.readUInt16LE(peOffset + 4);
	if (machine === 0x8664) {
		return { format: 'pe32-plus', architecture: 'x64', machine: 'IMAGE_FILE_MACHINE_AMD64' };
	}
	if (machine === 0xaa64) {
		return { format: 'pe32-plus', architecture: 'arm64', machine: 'IMAGE_FILE_MACHINE_ARM64' };
	}
	throw new TypeError(`The PE binary machine ${String(machine)} is unsupported.`);
}

function machArchitecture(bytes) {
	const magic = bytes.readUInt32BE(0);
	if (FAT_MAGICS.has(magic)) {
		throw new TypeError('Fat or universal Mach-O binaries are not admitted.');
	}
	if (bytes.readUInt32LE(0) !== 0xfeedfacf || bytes.byteLength < 12) {
		throw new TypeError('The Mach-O binary header is malformed or is not little-endian 64-bit.');
	}
	const machine = bytes.readInt32LE(4);
	if (machine === 0x0100000c) {
		return { format: 'mach-o-64-le', architecture: 'arm64', machine: 'CPU_TYPE_ARM64' };
	}
	if (machine === 0x01000007) {
		return { format: 'mach-o-64-le', architecture: 'x64', machine: 'CPU_TYPE_X86_64' };
	}
	throw new TypeError(`The Mach-O CPU type ${String(machine)} is unsupported.`);
}

function canonicalPath(value) {
	if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value
		|| value.includes('\0')) throw new TypeError('The native binary path must be absolute and normalized.');
	return value;
}

function targetId(value) {
	if (typeof value !== 'string' || !TARGETS.has(value)) {
		throw new TypeError('The native binary target is unsupported.');
	}
	return value;
}

function maximumByteLength(value) {
	const maximum = value ?? DEFAULT_MAXIMUM_BYTES;
	if (!Number.isSafeInteger(maximum) || maximum < 12 || maximum > DEFAULT_MAXIMUM_BYTES) {
		throw new TypeError('The native binary byte budget is invalid.');
	}
	return maximum;
}

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}

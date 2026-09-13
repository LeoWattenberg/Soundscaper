/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact OpenFX host ABI admission, including final-image ARM64EC/CHPE metadata. */

import {
	assertSoundscaperNativeBinaryArchitecture,
	validateSoundscaperNativeBinaryArchitectureReceipt,
} from './soundscaper-native-binary-architecture.mjs';

const ROLES = new Set(['openfx-host', 'isolation-launcher', 'runtime-library']);
const ARM64EC_RECEIPT = Object.freeze({
	schemaVersion: 1,
	target: 'win-arm64',
	format: 'pe32-plus',
	architecture: 'arm64ec',
	machine: 'IMAGE_FILE_MACHINE_ARM64EC',
});
const LOAD_CONFIG_DIRECTORY = 10;
const LOAD_CONFIG_CHPE_END = 208;

export function assertFramescaperOpenFxBinaryArchitecture(value, target, roleValue) {
	const role = artifactRole(roleValue);
	if (target !== 'win-arm64' || role !== 'openfx-host') {
		return assertSoundscaperNativeBinaryArchitecture(value, target);
	}
	const bytes = byteBuffer(value);
	assertArm64EcFinalImage(bytes);
	return ARM64EC_RECEIPT;
}

export function validateFramescaperOpenFxBinaryArchitectureReceipt(
	value, target, roleValue,
) {
	const role = artifactRole(roleValue);
	if (target !== 'win-arm64' || role !== 'openfx-host') {
		return validateSoundscaperNativeBinaryArchitectureReceipt(value, target);
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.keys(value).sort().join(',')
			!== 'architecture,format,machine,schemaVersion,target'
		|| JSON.stringify(value) !== JSON.stringify(ARM64EC_RECEIPT)) {
		throw new TypeError('The OpenFX ARM64EC architecture receipt is invalid.');
	}
	return Object.freeze(value);
}

function assertArm64EcFinalImage(bytes) {
	if (bytes.byteLength < 0x100 || bytes.subarray(0, 2).toString('ascii') !== 'MZ') {
		throw new TypeError('The OpenFX ARM64EC PE image is malformed.');
	}
	const pe = bytes.readUInt32LE(0x3c);
	if (pe < 64 || pe > 65_536 || pe + 24 > bytes.byteLength
		|| bytes.subarray(pe, pe + 4).toString('binary') !== 'PE\0\0'
		|| bytes.readUInt16LE(pe + 4) !== 0x8664) {
		throw new TypeError('The OpenFX host is not an AMD64-compatible ARM64EC final image.');
	}
	const sectionCount = bytes.readUInt16LE(pe + 6);
	const optionalSize = bytes.readUInt16LE(pe + 20);
	const optional = pe + 24;
	if (sectionCount < 1 || sectionCount > 96 || optionalSize < 240
		|| optional + optionalSize + sectionCount * 40 > bytes.byteLength
		|| bytes.readUInt16LE(optional) !== 0x20b
		|| bytes.readUInt32LE(optional + 108) <= LOAD_CONFIG_DIRECTORY) {
		throw new TypeError('The OpenFX ARM64EC PE32+ headers are incomplete.');
	}
	const dataDirectory = optional + 112 + LOAD_CONFIG_DIRECTORY * 8;
	const loadConfigRva = bytes.readUInt32LE(dataDirectory);
	const loadConfigSize = bytes.readUInt32LE(dataDirectory + 4);
	const sections = sectionTable(bytes, optional + optionalSize, sectionCount);
	const loadConfig = rvaOffset(bytes, sections, loadConfigRva, LOAD_CONFIG_CHPE_END);
	if (loadConfigSize < LOAD_CONFIG_CHPE_END
		|| bytes.readUInt32LE(loadConfig) < LOAD_CONFIG_CHPE_END) {
		throw new TypeError('The OpenFX ARM64EC load configuration has no CHPE field.');
	}
	const imageBase = bytes.readBigUInt64LE(optional + 24);
	const metadataVa = bytes.readBigUInt64LE(loadConfig + 200);
	if (metadataVa <= imageBase || metadataVa - imageBase > 0xffff_ffffn) {
		throw new TypeError('The OpenFX ARM64EC final image has no CHPE metadata pointer.');
	}
	const metadata = rvaOffset(bytes, sections, Number(metadataVa - imageBase), 12);
	const version = bytes.readUInt32LE(metadata);
	const codeMapRva = bytes.readUInt32LE(metadata + 4);
	const codeMapCount = bytes.readUInt32LE(metadata + 8);
	if (version < 1 || version > 3 || codeMapCount < 1 || codeMapCount > 1_048_576) {
		throw new TypeError('The OpenFX ARM64EC CHPE metadata is incomplete.');
	}
	rvaOffset(bytes, sections, codeMapRva, codeMapCount * 8);
}

function sectionTable(bytes, offset, count) {
	const sections = [];
	for (let index = 0; index < count; index += 1) {
		const start = offset + index * 40;
		sections.push(Object.freeze({
			virtualSize: bytes.readUInt32LE(start + 8),
			virtualAddress: bytes.readUInt32LE(start + 12),
			rawSize: bytes.readUInt32LE(start + 16),
			rawOffset: bytes.readUInt32LE(start + 20),
		}));
	}
	return Object.freeze(sections);
}

function rvaOffset(bytes, sections, rva, length) {
	if (!Number.isSafeInteger(rva) || !Number.isSafeInteger(length) || rva < 1 || length < 1) {
		throw new TypeError('The OpenFX ARM64EC PE image contains an invalid RVA.');
	}
	for (const section of sections) {
		const delta = rva - section.virtualAddress;
		if (delta >= 0 && delta < section.virtualSize && length <= section.virtualSize - delta
			&& delta < section.rawSize && length <= section.rawSize - delta
			&& section.rawOffset + delta + length <= bytes.byteLength) {
			return section.rawOffset + delta;
		}
	}
	throw new TypeError('The OpenFX ARM64EC PE image contains an unmapped RVA.');
}

function byteBuffer(value) {
	const bytes = Buffer.isBuffer(value) ? value
		: ArrayBuffer.isView(value) ? Buffer.from(value.buffer, value.byteOffset, value.byteLength) : null;
	if (bytes === null) throw new TypeError('The OpenFX native binary must be a byte buffer.');
	return bytes;
}

function artifactRole(value) {
	if (typeof value !== 'string' || !ROLES.has(value)) {
		throw new TypeError('The OpenFX native artifact role is unsupported.');
	}
	return value;
}

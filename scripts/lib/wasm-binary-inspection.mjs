/* SPDX-License-Identifier: AGPL-3.0-only */

const codecPolicy = Object.freeze({
	lebMaximumBytes: 6,
	lebInvalidError: 'invalid unsigned LEB128',
	sectionBoundsError: 'section extends beyond artifact',
	strictMemorySection: false,
});

const strictAuditPolicy = Object.freeze({
	lebMaximumBytes: 5,
	lebTruncatedError: 'truncated unsigned LEB128 value',
	lebOverflowError: 'unsigned LEB128 value exceeds 32 bits',
	sectionBoundsError: 'section extends beyond the artifact',
	strictMemorySection: true,
});

const nyquistPolicy = Object.freeze({
	lebMaximumBytes: 5,
	lebTruncatedError: 'truncated LEB128 value',
	lebOverflowError: 'LEB128 value exceeds 32 bits',
	sectionBoundsError: 'section extends beyond artifact',
	strictMemorySection: false,
});

export function readCodecDefinedMemoryLimits(wasm) {
	return readDefinedMemoryLimits(wasm, codecPolicy);
}

export function readStrictDefinedMemoryLimits(wasm, {
	memory64Error = 'memory64 limits are not supported by this audit',
} = {}) {
	return readDefinedMemoryLimits(wasm, { ...strictAuditPolicy, memory64Error });
}

export function readNyquistDefinedMemoryLimits(wasm) {
	return readDefinedMemoryLimits(wasm, nyquistPolicy);
}

function readDefinedMemoryLimits(wasm, policy) {
	if (wasm.byteLength < 8 || wasm.readUInt32LE(0) !== 0x6d736100 || wasm.readUInt32LE(4) !== 1) {
		throw new Error('invalid WebAssembly header');
	}
	const limits = [];
	let offset = 8;
	while (offset < wasm.byteLength) {
		const sectionId = wasm[offset++];
		const sectionSize = readUnsignedLeb(wasm, offset, policy);
		offset = sectionSize.nextOffset;
		const sectionEnd = offset + sectionSize.value;
		if (sectionEnd > wasm.byteLength) throw new Error(policy.sectionBoundsError);
		if (sectionId === 5) {
			const count = readUnsignedLeb(wasm, offset, policy);
			offset = count.nextOffset;
			for (let index = 0; index < count.value; index += 1) {
				const flags = readUnsignedLeb(wasm, offset, policy);
				offset = flags.nextOffset;
				const memory64 = Boolean(flags.value & 0x04);
				if (memory64 && policy.memory64Error) throw new Error(policy.memory64Error);
				const minimum = readUnsignedLeb(wasm, offset, policy);
				offset = minimum.nextOffset;
				let maximumPages = null;
				if (flags.value & 0x01) {
					const maximum = readUnsignedLeb(wasm, offset, policy);
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
			if (policy.strictMemorySection && offset !== sectionEnd) {
				throw new Error('malformed memory section');
			}
		}
		offset = sectionEnd;
	}
	return limits;
}

function readUnsignedLeb(bytes, startOffset, policy) {
	let offset = startOffset;
	let value = 0;
	let multiplier = 1;
	for (let byteIndex = 0; byteIndex < policy.lebMaximumBytes; byteIndex += 1) {
		if (offset >= bytes.byteLength) {
			throw new Error(policy.lebInvalidError || policy.lebTruncatedError);
		}
		const byte = bytes[offset++];
		value += (byte & 0x7f) * multiplier;
		if ((byte & 0x80) === 0) return { value, nextOffset: offset };
		multiplier *= 128;
	}
	throw new Error(policy.lebInvalidError || policy.lebOverflowError);
}

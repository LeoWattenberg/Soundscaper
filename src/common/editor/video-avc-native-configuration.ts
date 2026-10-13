/* SPDX-License-Identifier: AGPL-3.0-only */

function requireOwned(condition: unknown): asserts condition {
	if (!condition) throw new Error('Owned AVC native configuration does not match its key packet.');
}
function same(a: Uint8Array, b: Uint8Array): boolean {
	return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

/**
 * Inverse of the observed native WriteExtraData serializer: it prepends NAL
 * headers to already header-bearing sets and writes zero reserved bits.
 * Only an owned key packet with byte-identical original sets authorizes this
 * inverse. The ordinary avcC parser remains strict and validates the result.
 */
export function restoreOwnedAvcConfiguration(input: Uint8Array, packet: Uint8Array, type: string): Uint8Array {
	if (input[4] !== 3 || input[5] !== 1) return input;
	requireOwned(input.length >= 16 && input.length <= 65_536 && input[0] === 1 && input[1] === 77 && type === 'key');
	let at = 6;
	const set = (header: number): Uint8Array => {
		requireOwned(at + 2 <= input.length);
		const size = input[at]! * 256 + input[at + 1]!; at += 2;
		requireOwned(size >= 3 && size <= 4096 && at + size <= input.length && input[at] === header && input[at + 1] === header);
		const result = input.subarray(at + 1, at + size); at += size;
		return result;
	};
	const sps = set(0x67);
	requireOwned(input[at++] === 1);
	const pps = set(0x68);
	requireOwned(at === input.length);
	let offset = 0, count = 0, sequenceSets = 0, pictureSets = 0;
	while (offset < packet.length) {
		requireOwned(++count <= 8192 && offset + 4 <= packet.length);
		const size = packet[offset]! * 0x1000000 + packet[offset + 1]! * 0x10000 + packet[offset + 2]! * 256 + packet[offset + 3]!;
		offset += 4;
		requireOwned(size > 0 && offset + size <= packet.length);
		const nal = packet.subarray(offset, offset + size); offset += size;
		const nalType = nal[0]! & 31;
		if (nalType === 7) { requireOwned(same(nal, sps)); sequenceSets += 1; }
		if (nalType === 8) { requireOwned(same(nal, pps)); pictureSets += 1; }
	}
	requireOwned(sequenceSets === 1 && pictureSets === 1);
	return Uint8Array.of(...input.subarray(0, 4), 255, 225, sps.length >> 8, sps.length & 255, ...sps,
		1, pps.length >> 8, pps.length & 255, ...pps);
}

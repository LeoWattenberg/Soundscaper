/* SPDX-License-Identifier: AGPL-3.0-only */

const encoder = new TextEncoder();
const BLOCK_BYTES = 512;

/** USTAR regular files stream without retaining a directory table or seeking backwards. */
export function motionTarFileHeader(name: string, byteLength: number): Uint8Array {
	if (!/^(?:frames\/frame\d{12}\.png|sequence\.json)$/u.test(name) || !Number.isSafeInteger(byteLength) || byteLength < 0) throw new TypeError('Invalid motion sequence TAR entry.');
	const header = new Uint8Array(BLOCK_BYTES);
	const text = (offset: number, value: string): void => { header.set(encoder.encode(value), offset); };
	const octal = (offset: number, length: number, value: number): void => {
		const digits = value.toString(8);
		if (digits.length >= length) throw new RangeError('Motion TAR entry size exceeds its USTAR header.');
		text(offset, digits.padStart(length - 1, '0'));
	};
	text(0, name); octal(100, 8, 0o644); octal(108, 8, 0); octal(116, 8, 0);
	octal(124, 12, byteLength); octal(136, 12, 0); header.fill(32, 148, 156);
	header[156] = 48; text(257, 'ustar'); text(263, '00');
	text(148, header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0'));
	header[154] = 0; header[155] = 32;
	return header;
}
export function motionTarPadding(byteLength: number): Uint8Array { return new Uint8Array((BLOCK_BYTES - byteLength % BLOCK_BYTES) % BLOCK_BYTES); }

/* SPDX-License-Identifier: AGPL-3.0-only */

export interface OrientationPixelsV1 { readonly width: number; readonly height: number; readonly rgba: Uint8Array }

export function photoOrientationGridV1(): OrientationPixelsV1 {
	const width = 32, height = 24, rgba = new Uint8Array(width * height * 4);
	const colors = [[224, 24, 24], [24, 176, 32], [32, 48, 224], [232, 216, 32],
		[216, 32, 200], [24, 192, 192], [240, 240, 240], [24, 24, 24],
		[232, 120, 24], [96, 40, 160], [32, 112, 80], [128, 128, 128]] as const;
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
		const color = colors[Math.floor(y / 8) * 4 + Math.floor(x / 8)]!;
		rgba.set([...color, 255], (y * width + x) * 4);
	}
	return Object.freeze({ width, height, rgba });
}

/** CIPA orientation coordinates, independent of the production native decoder. */
export function permuteExifRgbaV1(rgba: Uint8Array, width: number, height: number, orientation: number): OrientationPixelsV1 {
	admitOrientation(orientation);
	if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 32 || height > 32
		|| rgba.length !== width * height * 4) throw new RangeError('Orientation oracle exceeds its fixture geometry.');
	const swapped = orientation >= 5, outputWidth = swapped ? height : width, outputHeight = swapped ? width : height;
	const output = new Uint8Array(rgba.length);
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
		let dx = x, dy = y;
		if (orientation === 2) dx = width - 1 - x;
		else if (orientation === 3) { dx = width - 1 - x; dy = height - 1 - y; }
		else if (orientation === 4) dy = height - 1 - y;
		else if (orientation === 5) { dx = y; dy = x; }
		else if (orientation === 6) { dx = height - 1 - y; dy = x; }
		else if (orientation === 7) { dx = height - 1 - y; dy = width - 1 - x; }
		else if (orientation === 8) { dx = y; dy = width - 1 - x; }
		output.set(rgba.subarray((y * width + x) * 4, (y * width + x) * 4 + 4), (dy * outputWidth + dx) * 4);
	}
	return Object.freeze({ width: outputWidth, height: outputHeight, rgba: output });
}

/** Inject classic TIFF Exif; compressed JPEG data is copied without recompression. */
export function jpegWithExifOrientationV1(jpeg: Uint8Array, orientation: number, colorSpace = 1): Uint8Array {
	admitOrientation(orientation);
	if (jpeg.length < 4 || jpeg.length > 64 * 1024 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8
		|| jpeg[jpeg.length - 2] !== 0xff || jpeg[jpeg.length - 1] !== 0xd9) throw new RangeError('Orientation fixture requires a bounded JPEG.');
	if (!Number.isInteger(colorSpace) || colorSpace < 0 || colorSpace > 65535) throw new RangeError('Exif color fixture requires a SHORT.');
	const tiff = new Uint8Array(56), view = new DataView(tiff.buffer);
	tiff.set([0x49, 0x49, 0x2a, 0]); view.setUint32(4, 8, true); view.setUint16(8, 2, true);
	entry(view, 10, 0x0112, 3, orientation); entry(view, 22, 0x8769, 4, 38);
	view.setUint16(38, 1, true); entry(view, 40, 0xa001, 3, colorSpace);
	const segment = new Uint8Array(66); segment.set([0xff, 0xe1, 0, 64, 69, 120, 105, 102, 0, 0]); segment.set(tiff, 10);
	const output = new Uint8Array(jpeg.length + segment.length);
	output.set(jpeg.subarray(0, 2)); output.set(segment, 2); output.set(jpeg.subarray(2), 68); return output;
}

/** Only the test-created sRGB canvas seed loses encoder ICC metadata, before File selection. */
export function unprofiledCanvasJpegFixtureV1(jpeg: Uint8Array): Readonly<{ jpeg: Uint8Array; removedIccSegments: number }> {
	if (jpeg.length > 64 * 1024 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new RangeError('Canvas seed requires a bounded JPEG.');
	const view = new DataView(jpeg.buffer, jpeg.byteOffset, jpeg.byteLength), parts = [jpeg.subarray(0, 2)];
	const prefix = new TextEncoder().encode('ICC_PROFILE\0');
	let offset = 2, removedIccSegments = 0;
	while (offset < jpeg.length) {
		if (jpeg[offset] !== 0xff) throw new RangeError('Canvas seed has an invalid header.');
		const marker = jpeg[offset + 1];
		if (marker === 0xda || marker === 0xd9) { parts.push(jpeg.subarray(offset)); break; }
		if (offset > jpeg.length - 4) throw new RangeError('Canvas seed header is truncated.');
		const length = view.getUint16(offset + 2), end = offset + 2 + length;
		if (length < 2 || end > jpeg.length) throw new RangeError('Canvas seed segment is truncated.');
		const icc = marker === 0xe2 && length >= 16 && prefix.every((value, index) => jpeg[offset + 4 + index] === value);
		if (icc) removedIccSegments++; else parts.push(jpeg.subarray(offset, end));
		offset = end;
	}
	const output = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
	let outputOffset = 0; for (const part of parts) { output.set(part, outputOffset); outputOffset += part.length; }
	return Object.freeze({ jpeg: output, removedIccSegments });
}

function entry(view: DataView, offset: number, tag: number, type: 3 | 4, value: number): void {
	view.setUint16(offset, tag, true); view.setUint16(offset + 2, type, true); view.setUint32(offset + 4, 1, true);
	if (type === 3) view.setUint16(offset + 8, value, true); else view.setUint32(offset + 8, value, true);
}
function admitOrientation(value: number): void {
	if (!Number.isInteger(value) || value < 1 || value > 8) throw new RangeError('Orientation fixture requires Exif orientation1..8.');
}

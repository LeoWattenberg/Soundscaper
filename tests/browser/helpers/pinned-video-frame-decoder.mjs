/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';

const CORE_JAVASCRIPT = new URL('../../../node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js', import.meta.url);
const CORE_WASM = new URL('../../../node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm', import.meta.url);

let corePromise = null;
let operationOrdinal = 0;

/** Decode the first displayed frame with the exact software decoder shipped by Soundscaper. */
export async function decodePinnedVideoRgbFrame(bytes) {
	if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
		throw new TypeError('Pinned video frame decoding requires nonempty Uint8Array bytes.');
	}
	const core = await loadPinnedCore();
	operationOrdinal += 1;
	const inputPath = `nightly-video-frame-${String(operationOrdinal)}.input`;
	const outputPath = `nightly-video-frame-${String(operationOrdinal)}.ppm`;
	const logs = [];
	core.setLogger(({ message }) => {
		if (typeof message === 'string') logs.push(message);
		if (logs.length > 100) logs.shift();
	});
	try {
		core.FS.writeFile(inputPath, bytes.slice());
		const exitCode = core.exec(
			'-hide_banner', '-nostdin', '-y', '-i', inputPath,
			'-frames:v', '1', '-c:v', 'ppm', '-f', 'image2', outputPath,
		);
		if (exitCode !== 0) {
			throw new Error(`Pinned video frame decoding exited ${String(exitCode)}.\n${logs.join('\n')}`);
		}
		return decodePpm(core.FS.readFile(outputPath));
	} finally {
		core.setLogger(() => {});
		try { core.FS.unlink(inputPath); } catch {}
		try { core.FS.unlink(outputPath); } catch {}
	}
}

/** Read one RGB triplet from a decoded frame with explicit bounds checks. */
export function readRgbPixel(frame, point) {
	if (!frame || !(frame.rgb instanceof Uint8Array)) {
		throw new TypeError('Decoded RGB frame bytes are invalid.');
	}
	const width = positiveInteger(frame.width, 'Decoded RGB frame width');
	const height = positiveInteger(frame.height, 'Decoded RGB frame height');
	if (frame.rgb.byteLength !== width * height * 3) {
		throw new RangeError('Decoded RGB frame byte length does not match its geometry.');
	}
	const x = nonnegativeInteger(point?.x, 'Decoded RGB pixel x');
	const y = nonnegativeInteger(point?.y, 'Decoded RGB pixel y');
	if (x >= width || y >= height) throw new RangeError('Decoded RGB pixel coordinates are out of bounds.');
	const offset = (y * width + x) * 3;
	return [frame.rgb[offset], frame.rgb[offset + 1], frame.rgb[offset + 2]];
}

async function loadPinnedCore() {
	corePromise ??= (async () => {
		globalThis.self ??= globalThis;
		globalThis.location ??= CORE_JAVASCRIPT;
		const [{ default: createCore }, wasmBinary] = await Promise.all([
			import(CORE_JAVASCRIPT.href),
			readFile(CORE_WASM),
		]);
		return createCore({ wasmBinary });
	})();
	return corePromise;
}

function decodePpm(value) {
	if (!(value instanceof Uint8Array)) throw new TypeError('Pinned decoder returned invalid PPM bytes.');
	let offset = 0;
	const token = () => {
		while (offset < value.byteLength && isAsciiWhitespace(value[offset])) offset += 1;
		const start = offset;
		while (offset < value.byteLength && !isAsciiWhitespace(value[offset])) offset += 1;
		if (start === offset) throw new Error('Pinned decoder returned a malformed PPM header.');
		return new TextDecoder().decode(value.subarray(start, offset));
	};
	if (token() !== 'P6') throw new Error('Pinned decoder did not return a binary RGB PPM frame.');
	const width = decimalInteger(token(), 'Pinned decoder PPM width');
	const height = decimalInteger(token(), 'Pinned decoder PPM height');
	if (token() !== '255') throw new Error('Pinned decoder PPM frame must use eight-bit RGB channels.');
	if (!isAsciiWhitespace(value[offset])) throw new Error('Pinned decoder returned a malformed PPM separator.');
	offset += value[offset] === 13 && value[offset + 1] === 10 ? 2 : 1;
	const expectedBytes = width * height * 3;
	if (!Number.isSafeInteger(expectedBytes) || value.byteLength - offset !== expectedBytes) {
		throw new Error('Pinned decoder PPM payload does not match its declared geometry.');
	}
	return Object.freeze({ width, height, rgb: value.slice(offset) });
}

function decimalInteger(value, label) {
	if (!/^[1-9]\d*$/u.test(value)) throw new Error(`${label} is invalid.`);
	return positiveInteger(Number(value), label);
}

function positiveInteger(value, label) {
	if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive safe integer.`);
	return value;
}

function nonnegativeInteger(value, label) {
	if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative safe integer.`);
	return value;
}

function isAsciiWhitespace(value) {
	return value === 9 || value === 10 || value === 12 || value === 13 || value === 32;
}

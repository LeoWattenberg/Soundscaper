/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { rawDngFixtureV1, RAW_DNG_BLACK, RAW_DNG_WHITE } from '../../helpers/lightscaper-raw-dng-current-fixture.ts';
import { decodeLibRawOriginalWasmV1 } from '../../../src/common/editor/raw/libraw-wasm-instance-v1.ts';

/** Actual independent Bayer bracket. Only the longer sensor exposure is
 * changed: black-subtracted samples are multiplied by four and sensor-clipped.
 * Neither source contains an embedded rendered preview or a merged HDR body. */
export async function hdrMergeBrowserFixtureCurrentV1() {
	const manifest = JSON.parse(await readFile(new URL('../../../config/lightscaper-libraw-runtime-manifest.json', import.meta.url), 'utf8')) as {
		runtime: { path: string; byteLength: number; sha256: string };
	};
	const wasm = new Uint8Array(await readFile(new URL(`../../../${manifest.runtime.path}`, import.meta.url)));
	if (wasm.byteLength !== manifest.runtime.byteLength || hash(wasm) !== manifest.runtime.sha256) throw new Error('HDR browser oracle requires the pinned ABI1 runtime.');
	const module = await WebAssembly.compile(wasm), short = rawDngFixtureV1(6), long = rawDngFixtureV1(6);
	const view = new DataView(long.bytes.buffer);
	for (let index = 0; index < long.sensor.length; index++) view.setUint16(long.rawOffset + index * 2,
		RAW_DNG_BLACK + Math.min(RAW_DNG_WHITE - RAW_DNG_BLACK, 4 * (long.sensor[index]! - RAW_DNG_BLACK)), true);
	const inputs = [short.bytes, long.bytes], words: number[][] = [];
	for (const input of inputs) {
		const copied = new Uint8Array(input);
		try {
			const decoded = decodeLibRawOriginalWasmV1(module, copied);
			try {
				if (decoded.rawFlip !== 6 || decoded.frame.descriptor.width !== 32 || decoded.frame.descriptor.height !== 32) throw new Error('HDR bracket native orientation or extent differs.');
				words.push(Array.from(decoded.frame.pixels));
			} finally { decoded.frame.pixels.fill(0); }
		} finally { copied.fill(0); }
	}
	// Literal endpoint weighting and one final Float32 store. This oracle does
	// not import the merge engine, alignment, radiance, HDR codec or renderer.
	const values: number[] = [], bits: number[] = [], payload = new Uint8Array(32 * 32 * 12), encoded = new DataView(payload.buffer);
	let maximum = 0, nonWordSamples = 0;
	for (let pixel = 0; pixel < 32 * 32; pixel++) {
		for (let channel = 0; channel < 3; channel++) {
			const a = words[0]![pixel * 4 + channel]! / 65535, b = words[1]![pixel * 4 + channel]! / 65535;
			const wa = Math.min(a, 1 - a), wb = Math.min(b, 1 - b);
			const n = Math.fround(wa + wb > 0 ? (wa * (a / .25) + wb * b) / (wa + wb) : Math.max(a / .25, b));
			const offset = (pixel * 3 + channel) * 4; encoded.setFloat32(offset, n, true); bits.push(encoded.getUint32(offset, true)); values.push(n);
			maximum = Math.max(maximum, n); if (n * 65535 !== Math.round(n * 65535)) nonWordSamples++;
		}
		values.push(1);
	}
	if (maximum <= 1 || nonWordSamples < 100) throw new Error('The actual HDR bracket must retain headroom and non-word-grid working values.');
	const pixelsSha256 = hash(payload); payload.fill(0);
	return { wasm, sources: inputs.map((bytes, index) => ({ bytes, sha256: hash(bytes), name: index === 0 ? 'HDR bracket short.dng' : 'HDR bracket long.dng' })),
		width: 32, height: 32, words, values, bits, pixelsSha256, maximum, nonWordSamples, preview: display(values), developed: display(values, -2) };
}
function display(values: readonly number[], exposure = 0) { return values.map((value, index) => {
	if (index % 4 === 3) return 255;
	const n = Math.max(0, Math.min(1, exposure === 0 ? value : Math.fround(value * 2 ** exposure)));
	return Math.round(255 * (n <= .0031308 ? n * 12.92 : 1.055 * n ** (1 / 2.4) - .055));
}); }
function hash(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }

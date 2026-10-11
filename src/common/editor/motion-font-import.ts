/* SPDX-License-Identifier: AGPL-3.0-only */
import type { CanvasKit } from 'canvaskit-wasm';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { normalizeMotionAsset, type MotionAsset } from './motion-asset.ts';
import { motionId, motionString } from './motion-values.ts';

/** Retain selected font bytes only after bounded format admission and the same native typeface decoder used by rendering. */
export async function prepareMotionFont(body: Blob, options: Readonly<{ id: string; name: string; style: string }>, kit: CanvasKit, signal?: AbortSignal): Promise<Readonly<{ asset: Extract<MotionAsset, { kind: 'font' }>; body: Blob }>> {
	signal?.throwIfAborted(); const id = motionId(options.id), name = motionString(options.name, 'font name'), style = motionString(options.style, 'font style');
	if (body.size < 12 || body.size > 16 * 1024 * 1024) throw new RangeError('Font source size exceeds its 16 MiB import budget.');
	const bytes = new Uint8Array(await body.arrayBuffer()); signal?.throwIfAborted(); const mimeType = fontFormat(bytes);
	const face = kit.Typeface.MakeFreeTypeFaceFromData(bytes.buffer); if (!face) throw new Error('The retained font cannot be decoded by the motion text renderer.');
	let family: string;
	try { signal?.throwIfAborted(); family = motionString(face.getFamilyName(), 'font family'); } finally { face.delete(); }
	const digest = bytesToHex(sha256(bytes)); const asset = normalizeMotionAsset({ id, name, kind: 'font', family, style, mimeType, sha256: digest, storageKey: `motion-sha256:${digest}`, byteLength: bytes.byteLength });
	if (asset.kind !== 'font') throw new TypeError('Expected a retained font.');
	return Object.freeze({ asset, body: new Blob([bytes], { type: mimeType }) });
}
function fontFormat(bytes: Uint8Array): string {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); const signature = view.getUint32(0); const decodedLimit = 32 * 1024 * 1024;
	if (signature === 0x774f4646 || signature === 0x774f4632) {
		if (bytes.length < (signature === 0x774f4632 ? 48 : 44) || view.getUint32(8) !== bytes.length || view.getUint16(12) < 1 || view.getUint16(12) > 4096 || view.getUint32(16) > decodedLimit) throw new RangeError('Compressed font structure or decoded size exceeds its import budget.');
		return signature === 0x774f4632 ? 'font/woff2' : 'font/woff';
	}
	if (signature !== 0x00010000 && signature !== 0x4f54544f) throw new TypeError('Choose one TrueType, OpenType, WOFF or WOFF2 font face.');
	const count = view.getUint16(4); if (count < 1 || count > 4096 || 12 + count * 16 > bytes.length) throw new RangeError('Font table count exceeds its bounded source.');
	let total = 0;
	for (let index = 0; index < count; index++) {
		const start = view.getUint32(12 + index * 16 + 8), length = view.getUint32(12 + index * 16 + 12); total += length;
		if (start + length > bytes.length || total > decodedLimit) throw new RangeError('Font tables exceed their retained byte and decoded-size budget.');
	}
	return signature === 0x4f54544f ? 'font/otf' : 'font/ttf';
}

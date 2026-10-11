/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { decodeMotionPngPixels } from '../../tests/browser/helpers/motion-png-pixels.ts';
import { MOTION_SUSTAINED_PLAN } from './motionscaper-sustained-plan.ts';

function sameFile(left: BigIntStats, right: BigIntStats): boolean {
	return left.isFile() && right.isFile() && left.dev === right.dev && left.ino === right.ino
		&& left.size === right.size && left.ctimeNs === right.ctimeNs && left.mtimeNs === right.mtimeNs;
}
interface Selection { readonly frames: 300 | 1200; readonly revisionDigest: string; readonly projectId: string; readonly compositionId: string }
export async function verifyMotionSustainedPng(path: string, selection: Selection) {
	const plan = MOTION_SUSTAINED_PLAN;
	if (!plan.runs.includes(selection.frames) || !/^[a-f\d]{64}$/u.test(selection.revisionDigest)
		|| !selection.projectId || !selection.compositionId) throw new Error('Invalid sustained PNG selection.');
	const pathBefore = await lstat(path, { bigint: true });
	if (!pathBefore.isFile() || pathBefore.size < 1024n || pathBefore.size > BigInt(plan.maximumOutputBytes)) throw new Error('Sustained TAR requires a bounded regular file.');
	const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); const hash = createHash('sha256'); let offset = 0, maximumReadBytes = 0;
	const selected: { index: number; name: string; byteLength: number; sha256: string; png: Uint8Array }[] = [];
	try {
		const before = await file.stat({ bigint: true });
		if (!sameFile(pathBefore, before)) throw new Error('Sustained TAR changed before verification.');
		const size = Number(before.size);
		async function read(length: number): Promise<Buffer> {
			if (offset + length > size) throw new Error('Truncated sustained TAR.');
			const bytes = Buffer.alloc(length); let position = 0;
			while (position < length) {
				const count = Math.min(length - position, plan.maximumReadBytes); maximumReadBytes = Math.max(maximumReadBytes, count);
				const result = await file.read(bytes, position, count, offset + position);
				if (!result.bytesRead) throw new Error('Truncated sustained TAR read.'); position += result.bytesRead;
			}
			hash.update(bytes); offset += length; return bytes;
		}
		async function entry(expected: string, maximum: number): Promise<Buffer> {
			const header = await read(512); const nul = header.indexOf(0, 0);
			const name = header.toString('utf8', 0, Math.min(nul, 100));
			const octal = (start: number, end: number) => {
				const text = header.toString('ascii', start, end).replace(/\0.*$/u, '').trim();
				if (!/^[0-7]+$/u.test(text)) throw new Error('Invalid sustained TAR numeric field.'); return Number.parseInt(text, 8);
			};
			if (nul < 0 || nul > 99 || name !== expected || header[156] !== 48 || header.toString('ascii', 257, 265) !== 'ustar\0' + '00'
				|| header.subarray(345).some(byte => byte !== 0)) throw new Error('Sustained TAR entry order or type differs.');
			if (octal(148, 156) !== header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0)) throw new Error('Sustained TAR checksum differs.');
			const length = octal(124, 136);
			if (!Number.isSafeInteger(length) || length < 1 || length > maximum) throw new Error('Sustained TAR entry byte admission failed.');
			const bytes = await read(length); const padding = await read((512 - length % 512) % 512);
			if (padding.some(byte => byte !== 0)) throw new Error('Sustained TAR padding differs.');
			return bytes;
		}
		for (let index = 0; index < selection.frames; index++) {
			const name = `frames/frame${String(index + 1).padStart(12, '0')}.png`;
			const bytes = await entry(name, plan.width * plan.height * 6 + 65536);
			if (bytes.length < 33 || bytes.readUInt32BE(16) !== plan.width || bytes.readUInt32BE(20) !== plan.height) throw new Error('Sustained PNG dimensions differ.');
			const decoded = decodeMotionPngPixels(bytes);
			if (decoded.width !== plan.width || decoded.height !== plan.height) throw new Error('Sustained PNG dimensions differ.');
			if ([0, Math.floor(selection.frames / 2), selection.frames - 1].includes(index)) selected.push({ index, name, byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), png: bytes });
		}
		const metadata: unknown = JSON.parse((await entry('sequence.json', 65536)).toString('utf8'));
		const expected = { format: 'motionscaper-png-sequence', version: 1,
			identity: { projectId: selection.projectId, compositionId: selection.compositionId, revisionDigest: selection.revisionDigest },
			width: plan.width, height: plan.height, frameRate: { num: plan.fps, den: 1 }, firstFrame: 0, frameCount: selection.frames,
			colorSpace: 'srgb', alphaMode: 'straight', pattern: 'frames/frame%012d.png' };
		if (!isDeepStrictEqual(metadata, expected)) throw new Error('Sustained sequence metadata or identity differs.');
		if ((await read(1024)).some(byte => byte !== 0) || offset !== size) throw new Error('Sustained TAR completion or trailing bytes differ.');
		const [after, pathAfter] = await Promise.all([file.stat({ bigint: true }), lstat(path, { bigint: true })]);
		if (!sameFile(before, after) || !sameFile(before, pathAfter)) throw new Error('Sustained TAR changed during verification.');
		return { byteLength: offset, sha256: hash.digest('hex'), frames: selection.frames, metadata: expected, selected,
			maximumReadBytes, retainedPngBytes: selected.reduce((sum, frame) => sum + frame.byteLength, 0) };
	} finally { await file.close(); }
}

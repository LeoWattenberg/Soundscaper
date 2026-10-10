/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { Rational } from './timeline-time.ts';
import { freezeMotionValue, motionBoolean, motionDigest, motionEnum, motionId, motionInteger, motionRational, motionRecord, motionString } from './motion-values.ts';

interface MotionAssetBase {
	readonly id: string; readonly name: string; readonly sha256: string;
	readonly byteLength: number; readonly storageKey: string; readonly mimeType: string;
}
interface MotionImageMetadata { readonly width: number; readonly height: number; readonly hasAlpha: boolean }
export type MotionAsset =
	| (MotionAssetBase & MotionImageMetadata & { readonly kind: 'image' })
	| (MotionAssetBase & MotionImageMetadata & { readonly kind: 'footage'; readonly frameRate: Rational; readonly duration: Rational; readonly hasAudio: boolean })
	| (MotionAssetBase & { readonly kind: 'audio'; readonly sampleRate: number; readonly channels: number; readonly duration: Rational })
	| (MotionAssetBase & { readonly kind: 'font'; readonly family: string; readonly style: string });

const BASE_FIELDS = ['id', 'name', 'kind', 'sha256', 'byteLength', 'storageKey', 'mimeType'];
const KIND_FIELDS = {
	image: ['width', 'height', 'hasAlpha'],
	footage: ['width', 'height', 'hasAlpha', 'frameRate', 'duration', 'hasAudio'],
	audio: ['sampleRate', 'channels', 'duration'],
	font: ['family', 'style'],
} as const;

export function normalizeMotionAsset(value: unknown): MotionAsset {
	const candidate = motionRecord(value, [...BASE_FIELDS, ...new Set(Object.values(KIND_FIELDS).flat())], 'motion asset', ['kind']);
	const kind = motionEnum(candidate.kind, ['image', 'footage', 'audio', 'font'], 'asset kind');
	const asset = motionRecord(candidate, [...BASE_FIELDS, ...KIND_FIELDS[kind]], 'motion asset');
	const digest = motionDigest(asset.sha256);
	if (asset.storageKey !== `motion-sha256:${digest}`) throw new RangeError('Motion asset storageKey must bind its digest.');
	const mimeType = motionString(asset.mimeType, 'asset MIME type', 128);
	if (!/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/u.test(mimeType)) throw new TypeError('Asset MIME type must be canonical.');
	const base = { id: motionId(asset.id, 'asset ID'), name: motionString(asset.name, 'asset name'),
		sha256: digest, byteLength: motionInteger(asset.byteLength, 'asset byte length', 1), storageKey: asset.storageKey as string, mimeType };
	if (kind === 'font') return freezeMotionValue({ ...base, kind, family: motionString(asset.family, 'font family'), style: motionString(asset.style, 'font style') });
	if (kind === 'audio') return freezeMotionValue({ ...base, kind, sampleRate: motionInteger(asset.sampleRate, 'asset sample rate', 8000, 768000), channels: motionInteger(asset.channels, 'asset channels', 1, 64), duration: motionRational(asset.duration, 'asset duration', true) });
	const image = { width: motionInteger(asset.width, 'asset width', 1, 65536), height: motionInteger(asset.height, 'asset height', 1, 65536), hasAlpha: motionBoolean(asset.hasAlpha, 'asset alpha') };
	return kind === 'image' ? freezeMotionValue({ ...base, kind, ...image }) : freezeMotionValue({ ...base, kind, ...image,
		frameRate: motionRational(asset.frameRate, 'asset frame rate', true), duration: motionRational(asset.duration, 'asset duration', true), hasAudio: motionBoolean(asset.hasAudio, 'asset audio') });
}

/** Bytes become usable only after their complete content-address binding is verified. */
export function verifyMotionAssetBody(value: unknown, body: Uint8Array): void {
	const asset = normalizeMotionAsset(value);
	if (!(body instanceof Uint8Array) || body.byteLength !== asset.byteLength) throw new RangeError('Motion asset byte length does not match its contract.');
	if (bytesToHex(sha256(body)) !== asset.sha256) throw new RangeError('Motion asset digest does not match its content.');
}

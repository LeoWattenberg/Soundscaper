/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
	boundVideoSourceTimingViewInfo,
	videoSourceFrameTime,
	type BoundVideoSourceTimingView,
} from './video-source-timing-view.ts';
import {
	dataArrayProperty,
	dataProperty,
	dataRecord,
	nonEmptyString,
} from './video-proxy-relationship-values.ts';

const TEXT_ENCODER = new TextEncoder();

export function videoProxyTimelineOwnership(
	tracks: readonly unknown[],
	sequences: readonly unknown[],
): ReadonlyMap<string, readonly Record<string, string>[]> {
	const sequencesByTrack = new Map<string, string[]>();
	for (const sequenceValue of sequences) {
		const sequence = dataRecord(sequenceValue, 'project sequence');
		const sequenceId = nonEmptyString(dataProperty(sequence, 'id', 'project sequence'), 'sequence.id');
		for (const trackId of dataArrayProperty(sequence, 'trackIds', 'project sequence.trackIds')) {
			const id = nonEmptyString(trackId, 'project sequence trackId');
			const values = sequencesByTrack.get(id) ?? [];
			values.push(sequenceId);
			sequencesByTrack.set(id, values);
		}
	}
	const result = new Map<string, Record<string, string>[]>();
	for (const trackValue of tracks) {
		const track = dataRecord(trackValue, 'project track');
		const trackId = nonEmptyString(dataProperty(track, 'id', 'project track'), 'project track.id');
		for (const clipIdValue of dataArrayProperty(track, 'clipIds', 'project track.clipIds')) {
			const clipId = nonEmptyString(clipIdValue, 'project track clipId');
			const owners = result.get(clipId) ?? [];
			for (const sequenceId of sequencesByTrack.get(trackId) ?? []) owners.push({ trackId, sequenceId });
			result.set(clipId, owners);
		}
	}
	return result;
}

export function videoProxyTimingFingerprint(timing: BoundVideoSourceTimingView): string {
	const info = boundVideoSourceTimingViewInfo(timing);
	const digest = sha256.create();
	digest.update(TEXT_ENCODER.encode(`${info.kind}:${String(info.frameCount)};`));
	const last = info.kind === 'cfr' ? 1 : info.frameCount;
	for (let boundary = 0; boundary <= last; boundary += 1) {
		const exact = videoSourceFrameTime(timing, {
			numerator: BigInt(boundary),
			denominator: 1n,
		});
		digest.update(TEXT_ENCODER.encode(`${exact.numerator.toString()}/${exact.denominator.toString()};`));
	}
	return bytesToHex(digest.digest());
}

export function videoProxyScalarFingerprint(...values: readonly string[]): string {
	const digest = sha256.create();
	for (const value of values) {
		digest.update(TEXT_ENCODER.encode(value));
		digest.update(Uint8Array.of(0));
	}
	return bytesToHex(digest.digest());
}

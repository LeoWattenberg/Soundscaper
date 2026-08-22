/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed MessagePort authority for SCTI bytes consumed by one OpenFX V12 job. */

import { VIDEO_TIMING_ASSET_MAXIMUM_BYTES } from '../src/common/editor/video-timing-asset-reference.ts';
import type { HelperDataPlaneBinding } from './helper-data-plane.ts';
import { HelperContractViolationError } from './helper-wire-admission.ts';

export const HELPER_OFX_VIDEO_TIMING_MAXIMUM_GRANTS = 4_096;

export interface HelperOfxVideoTimingAssetGrant {
	readonly role: 'video-timing';
	readonly binding: HelperDataPlaneBinding;
}

export function validateHelperOfxVideoTimingAssetGrants(
	value: unknown,
	dataBinding: (
		value: unknown,
		direction: HelperDataPlaneBinding['direction'],
		label: string,
	) => HelperDataPlaneBinding,
): readonly HelperOfxVideoTimingAssetGrant[] {
	if (!Array.isArray(value) || value.length < 1
		|| value.length > HELPER_OFX_VIDEO_TIMING_MAXIMUM_GRANTS) {
		return unsafe('An OpenFX timing authority requires 1 through 4,096 exact streams.');
	}
	const streamIds = new Set<string>();
	const digests = new Set<string>();
	return Object.freeze(value.map((candidate) => {
		const record = exactRecord(candidate);
		if (record.role !== 'video-timing') {
			return unsafe('An OpenFX timing stream requires its exact video-timing role.');
		}
		const binding = dataBinding(record.binding, 'host-to-helper', 'OpenFX video timing asset');
		if (binding.byteLength < 1 || binding.byteLength > VIDEO_TIMING_ASSET_MAXIMUM_BYTES) {
			return unsafe('An OpenFX timing stream exceeds the bounded SCTI byte domain.');
		}
		if (streamIds.has(binding.streamId) || digests.has(binding.sha256)) {
			return unsafe('An OpenFX timing stream cannot replay a stream or digest identity.');
		}
		streamIds.add(binding.streamId);
		digests.add(binding.sha256);
		return Object.freeze({ role: 'video-timing' as const, binding });
	}));
}

function exactRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		return unsafe('An OpenFX timing grant must be a plain record.');
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record);
	if (keys.length !== 2 || !keys.includes('role') || !keys.includes('binding')) {
		return unsafe('An OpenFX timing grant must carry exactly role and binding.');
	}
	return record;
}

function unsafe(message: string): never {
	throw new HelperContractViolationError('unsafe-grant', message);
}

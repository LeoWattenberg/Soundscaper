/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { freezeMotionValue, motionArray, motionDigest, motionId, motionInteger, motionRecord } from './motion-values.ts';
import { normalizeMotionscaperProject } from './motion-project-validation.ts';
import type { MotionscaperProject } from './motion-project-types.ts';

export interface MotionscaperRevision {
	readonly schemaVersion: 1; readonly projectId: string; readonly revision: number; readonly digest: string;
	readonly project: MotionscaperProject; readonly assetDigests: readonly string[];
}

/** Explicit saving publishes this immutable intent snapshot; autosave is not publication. */
export function createMotionscaperRevision(value: unknown): MotionscaperRevision {
	const project = normalizeMotionscaperProject(value);
	return freezeMotionValue({ schemaVersion: 1 as const, projectId: project.id, revision: project.revision,
		digest: bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(project)))), project,
		assetDigests: [...new Set(project.assets.map((asset) => asset.sha256))].sort(),
	});
}

export function verifyMotionscaperRevision(value: unknown): MotionscaperRevision {
	const record = motionRecord(value, ['schemaVersion', 'projectId', 'revision', 'digest', 'project', 'assetDigests'], 'Motionscaper revision');
	if (record.schemaVersion !== 1) throw new RangeError('Unsupported Motionscaper revision version.');
	const expected = createMotionscaperRevision(record.project);
	if (motionId(record.projectId) !== expected.projectId || motionInteger(record.revision, 'saved revision') !== expected.revision) {
		throw new RangeError('Saved revision identity does not match its project.');
	}
	if (motionDigest(record.digest) !== expected.digest) throw new RangeError('Saved revision digest does not match its project.');
	const assets = motionArray(record.assetDigests, 16384, 'saved revision assets').map((digest) => motionDigest(digest));
	if (JSON.stringify(assets) !== JSON.stringify(expected.assetDigests)) throw new RangeError('Saved revision asset closure is incomplete or noncanonical.');
	return expected;
}

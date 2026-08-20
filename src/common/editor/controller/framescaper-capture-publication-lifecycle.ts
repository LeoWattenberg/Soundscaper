/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
	decideFramescaperCaptureRecovery,
	normalizeFramescaperCaptureSessionManifest,
	type FramescaperCaptureRecoveryDecision,
	type FramescaperCaptureSessionManifestV1,
} from '../framescaper-capture-session-manifest.ts';
import type { FramescaperCaptureSessionManifestRepository } from '../storage/framescaper-capture-session-manifest-repository.ts';
import type { FramescaperCaptureRecoveryProvenance } from './framescaper-capture-publication-plan.ts';

type ManifestLifecyclePort = Pick<FramescaperCaptureSessionManifestRepository, 'load' | 'replace'>;

export interface FramescaperCapturePublicationLifecycle {
	begin(
		manifest: FramescaperCaptureSessionManifestV1,
		provenance: FramescaperCaptureRecoveryProvenance,
	): Promise<FramescaperCaptureSessionManifestV1>;
	commit(manifest: FramescaperCaptureSessionManifestV1): Promise<FramescaperCaptureSessionManifestV1>;
}

/** Persist recovery intent and every terminal publication state through manifest CAS. */
export function createFramescaperCapturePublicationLifecycle(
	manifests: ManifestLifecyclePort,
	options: Readonly<{ readonly now?: () => number }> = {},
): FramescaperCapturePublicationLifecycle {
	if (!manifests || typeof manifests.load !== 'function' || typeof manifests.replace !== 'function') {
		throw new TypeError('Capture publication lifecycle requires a manifest repository.');
	}
	const now = options.now ?? Date.now;
	return Object.freeze({ begin, commit });

	async function begin(
		manifestValue: FramescaperCaptureSessionManifestV1,
		provenance: FramescaperCaptureRecoveryProvenance,
	): Promise<FramescaperCaptureSessionManifestV1> {
		const requested = normalizeFramescaperCaptureSessionManifest(manifestValue);
		const current = await currentManifest(manifests, requested);
		assertEvidenceIdentity(requested, current);
		if (current.state === 'finalizing' || current.state === 'published') {
			assertFinalizationIntent(current, provenance);
			assertNoInvalidStreams(current);
			return current;
		}
		if (current.state !== 'sealed') {
			throw new Error(`Capture publication cannot begin from manifest state ${current.state}.`);
		}
		assertNoInvalidStreams(current);
		const decision = recoveryDecision(provenance);
		const updatedAt = forwardTimestamp(current, now());
		const next = decision === null
			? normalizeFramescaperCaptureSessionManifest({
				...current,
				state: 'finalizing',
				updatedAt,
			})
			: decideFramescaperCaptureRecovery(current, decision, updatedAt);
		return manifests.replace(current, next);
	}

	async function commit(
		manifestValue: FramescaperCaptureSessionManifestV1,
	): Promise<FramescaperCaptureSessionManifestV1> {
		const expected = normalizeFramescaperCaptureSessionManifest(manifestValue);
		let current = await currentManifest(manifests, expected);
		assertEvidenceIdentity(expected, current);
		if (current.state === 'committed') return current;
		if (current.state === 'finalizing') {
			const published = normalizeFramescaperCaptureSessionManifest({
				...current,
				state: 'published',
				streams: current.streams.map((stream) => ({
					...stream,
					playability: 'playable',
				})),
				updatedAt: forwardTimestamp(current, now()),
			});
			current = await manifests.replace(current, published);
		}
		if (current.state !== 'published') {
			throw new Error(`Capture publication cannot commit from manifest state ${current.state}.`);
		}
		const committed = normalizeFramescaperCaptureSessionManifest({
			...current,
			state: 'committed',
			updatedAt: forwardTimestamp(current, now()),
		});
		return manifests.replace(current, committed);
	}
}

/** Stable evidence digest: lifecycle state and verdict changes cannot alter source provenance. */
export function digestFramescaperCaptureManifestEvidence(
	manifestValue: FramescaperCaptureSessionManifestV1,
): string {
	const manifest = normalizeFramescaperCaptureSessionManifest(manifestValue);
	const evidence = {
		version: manifest.version,
		sessionId: manifest.sessionId,
		generation: manifest.generation,
		projectFence: manifest.projectFence,
		origin: manifest.origin,
		clock: manifest.clock,
		streams: manifest.streams.map((stream) => ({
			streamId: stream.streamId,
			role: stream.role,
			required: stream.required,
			storage: stream.storage,
		})),
		createdAt: manifest.createdAt,
	};
	return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(evidence))));
}

async function currentManifest(
	manifests: ManifestLifecyclePort,
	expected: FramescaperCaptureSessionManifestV1,
): Promise<FramescaperCaptureSessionManifestV1> {
	const current = await manifests.load(expected.projectFence.projectId, expected.sessionId);
	if (!current) throw new Error(`Capture manifest ${expected.sessionId} no longer exists.`);
	return current;
}

function assertEvidenceIdentity(
	expected: FramescaperCaptureSessionManifestV1,
	current: FramescaperCaptureSessionManifestV1,
): void {
	if (digestFramescaperCaptureManifestEvidence(expected)
		!== digestFramescaperCaptureManifestEvidence(current)) {
		throw new Error('Capture manifest evidence changed before publication.');
	}
}

function assertFinalizationIntent(
	manifest: FramescaperCaptureSessionManifestV1,
	provenance: FramescaperCaptureRecoveryProvenance,
): void {
	if (manifest.recoveryDecision !== recoveryDecision(provenance)) {
		throw new Error('Capture recovery decision changed before publication retry.');
	}
}

function assertNoInvalidStreams(manifest: FramescaperCaptureSessionManifestV1): void {
	if (manifest.streams.some(({ playability }) => playability === 'invalid')) {
		throw new Error('An invalid capture stream cannot enter canonical publication.');
	}
}

function recoveryDecision(
	provenance: FramescaperCaptureRecoveryProvenance,
): FramescaperCaptureRecoveryDecision | null {
	switch (provenance) {
		case 'live': return null;
		case 'recovered': return 'recover';
		case 'import-as-is': return 'import-as-is';
	}
}

function forwardTimestamp(manifest: FramescaperCaptureSessionManifestV1, value: number): number {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new RangeError('Capture publication lifecycle time must be non-negative.');
	}
	return Math.max(manifest.updatedAt, value);
}

/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-private binding of baseline project source identities to managed bodies. */

import { createNativeMediaPlanEnvelopeV2 } from '../src/common/editor/native-media-plan-envelope-v2.ts';
import { nativeMediaPlanVideoTimingAssetInputs } from '../src/common/editor/native-media-plan-video-timing.ts';
import type { NativeQueueInputFingerprintV1 } from '../src/common/editor/native-queue-record.ts';
import {
	validateFramescaperDesktopBodyDescriptor,
	type FramescaperDesktopBodyDescriptor,
} from '../src/framescaper/desktop-project-library-body-contract.ts';

const SHA256 = /^[a-f0-9]{64}$/u;
const BASE_KINDS = Object.freeze(['video-original', 'video-proxy', 'video-timing'] as const);

export type FramescaperNativeProjectMediaBody = FramescaperDesktopBodyDescriptor;

/** Admit the baseline body inventory without narrowing it to an older video-only subset. */
export function framescaperNativeProjectBody(value: unknown): Readonly<FramescaperNativeProjectMediaBody> {
	const row = record(value, 'baseline native project body');
	if (row.kind === 'image-sequence-inventory' || row.kind === 'image-sequence-source-pack') {
		return validateFramescaperDesktopBodyDescriptor(value);
	}
	if (!(BASE_KINDS as readonly unknown[]).includes(row.kind)
		|| typeof row.encoding !== 'string' || typeof row.sourceId !== 'string' || row.sourceId.length === 0
		|| row.storageKey !== row.sourceId || typeof row.mimeType !== 'string' || row.mimeType.length === 0
		|| !Number.isSafeInteger(row.byteLength) || Number(row.byteLength) < 1
		|| typeof row.sha256 !== 'string' || !SHA256.test(row.sha256)) {
		throw new TypeError('A baseline native project body has invalid identity fields.');
	}
	return Object.freeze({
		kind: row.kind as FramescaperNativeProjectMediaBody['kind'], encoding: row.encoding,
		...(row.kind === 'video-proxy' && typeof row.bindingId === 'string'
			? { bindingId: row.bindingId } : {}),
		sourceId: row.sourceId, storageKey: row.sourceId, mimeType: row.mimeType,
		byteLength: Number(row.byteLength), sha256: row.sha256,
	});
}

/** Authenticate ordinary originals or both roots of each image-sequence source. */
export function framescaperNativeProjectPlanBodyMetadataMatches(
	plan: unknown,
	inputs: readonly NativeQueueInputFingerprintV1[],
	bodies: readonly Readonly<FramescaperNativeProjectMediaBody>[],
): boolean {
	try {
		const envelope = createNativeMediaPlanEnvelopeV2(plan);
		if (envelope.plan.sources.length !== inputs.length
			|| new Set(inputs.map(({ sourceId }) => sourceId)).size !== inputs.length) return false;
		for (const input of inputs) framescaperNativeOriginalBodyForInput(envelope.plan, input, bodies);
		for (const timing of nativeMediaPlanVideoTimingAssetInputs(envelope.plan)) {
			onlyBody(bodies, (body) => body.kind === 'video-timing'
				&& body.storageKey === timing.storageKey && body.sha256 === timing.sha256);
		}
		return true;
	} catch { return false; }
}

/** Return an ordinary source body; a carrier-owned sequence authenticates both roots and returns null. */
export function framescaperNativeOriginalBodyForInput(
	plan: unknown,
	input: NativeQueueInputFingerprintV1,
	bodies: readonly Readonly<FramescaperNativeProjectMediaBody>[],
): Readonly<FramescaperNativeProjectMediaBody> | null {
	const canonical = createNativeMediaPlanEnvelopeV2(plan).plan;
	const sources = canonical.sources.filter(({ sourceId, contentSha256 }) => (
		sourceId === input.sourceId && contentSha256 === input.sha256
	));
	if (sources.length !== 1) throw new Error('A native source fingerprint is outside its exact plan.');
	const professional = canonical.nodes.filter((node) => (
		node.kind === 'professional-media' && node.sourceNodeId === sources[0]!.nodeId
	));
	if (professional.length > 1) throw new Error('A native source has ambiguous professional authority.');
	const node = professional[0];
	if (node?.kind === 'professional-media' && node.imageSequence !== null) {
		const { inventory, sourcePack } = node.imageSequence;
		exactSequenceBody(bodies, inventory, 'image-sequence-inventory');
		exactSequenceBody(bodies, sourcePack, 'image-sequence-source-pack');
		return null;
	}
	return onlyBody(bodies, (body) => body.kind === 'video-original'
		&& body.sourceId === input.sourceId && body.sha256 === input.sha256);
}

function exactSequenceBody(
	bodies: readonly Readonly<FramescaperNativeProjectMediaBody>[],
	reference: Readonly<{ readonly storageKey: string; readonly sha256: string; readonly byteLength: number }>,
	kind: 'image-sequence-inventory' | 'image-sequence-source-pack',
): void {
	onlyBody(bodies, (body) => body.kind === kind && body.sourceId === reference.storageKey
		&& body.storageKey === reference.storageKey && body.sha256 === reference.sha256
		&& body.byteLength === reference.byteLength);
}

function onlyBody(
	bodies: readonly Readonly<FramescaperNativeProjectMediaBody>[],
	predicate: (body: Readonly<FramescaperNativeProjectMediaBody>) => boolean,
): Readonly<FramescaperNativeProjectMediaBody> {
	const matches = bodies.filter(predicate);
	if (matches.length !== 1) throw new Error('A native managed source body is absent or duplicated.');
	return matches[0]!;
}

function record(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`A ${name} is malformed.`);
	}
	return value as Readonly<Record<string, unknown>>;
}

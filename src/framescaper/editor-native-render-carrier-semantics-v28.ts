/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ProductVideoExportPlan } from '../common/editor/controller/product-video-export-strategy.ts';
import { canonicalizeNativeMediaPlan } from '../common/editor/native-media-plan-canonical-form.ts';
import { nativeMediaV14EncodeDispatch } from '../common/editor/native-media-v14-native-dispatch.ts';
import type { UnifiedExactRenderPlanV14 } from '../common/editor/unified-exact-render-plan.ts';
import { createFramescaperNativeRenderPlanAuthorityV28 } from './editor-native-render-plan-authority-v28.ts';
import {
	framescaperNativeRenderDeliveryRequestFromPlanV28,
	type FramescaperNativeRenderDeliveryRequestV28,
} from './editor-native-project-action-requests-v28.ts';
import { createFramescaperProjectUnifiedExactRenderPlanV27 } from './editor-project-unified-render-plan-v27.ts';
import { framescaperProjectV27FoundationShapeV28 } from './editor-project-v28-foundation.ts';
import type { FramescaperProjectV28 } from './editor-project-v28.ts';
import { FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v27.ts';
import type { FramescaperVideoExportPictureDispositionV27 } from './video-export-visual-execution-v27.ts';

export function assertFramescaperNativeCarrierFamiliesV28(
	plan: UnifiedExactRenderPlanV14,
	project: FramescaperProjectV28,
): void {
	for (const node of plan.nodes) {
		if (node.kind !== 'professional-media') continue;
		const source = plan.sources.find(({ nodeId }) => nodeId === node.sourceNodeId);
		if (!source || node.exportAuthority !== 'original') {
			throw new Error('Selected V28 professional-media original authority is incomplete.');
		}
	}
	assertExactV13CarrierFoundation(plan, project);
}

/** V14's verified no-op professional inventory must project to the exact V13 compositor plan. */
function assertExactV13CarrierFoundation(
	plan: UnifiedExactRenderPlanV14,
	project: FramescaperProjectV28,
): void {
	const inherited = framescaperProjectV27FoundationShapeV28(project);
	const delivery = framescaperNativeRenderDeliveryRequestFromPlanV28(plan);
	const expected = createFramescaperProjectUnifiedExactRenderPlanV27(
		FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE, inherited,
		carrierRenderAuthority(project, delivery, framescaperNativeCarrierPlanningRateV28(plan.output.frameRate)),
	);
	const projected = structuredClone(plan) as unknown as Record<string, unknown>;
	projected.version = 13;
	delete projected.deliveryProfile;
	projected.format = expected.format;
	projected.codecs = expected.codecs;
	projected.output = expected.output;
	projected.nodes = plan.nodes.filter(
		({ kind }) => kind !== 'professional-media' && kind !== 'openfx',
	).map((node) => {
		if (node.kind !== 'clip') return node;
		const inheritedNode = expected.nodes.find((candidate) => (
			candidate.kind === 'clip' && candidate.nodeId === node.nodeId
		));
		if (!inheritedNode || inheritedNode.kind !== 'clip') {
			throw new ReferenceError(`Selected V28 carrier clip ${node.nodeId} has no V13 foundation.`);
		}
		// V6 retime intents are addressed in output-frame ordinals. The V14
		// image delivery and the internal V13 Web carrier therefore own distinct,
		// already-validated intent snapshots even though their clip semantics match.
		return Object.freeze({ ...node, sourceTimeMapping: inheritedNode.sourceTimeMapping });
	});
	if (canonicalizeNativeMediaPlan(projected) !== canonicalizeNativeMediaPlan(expected)) {
		throw new Error('Selected V28 V14 semantics exceed the exact inherited V13 Web carrier subset.');
	}
}

function carrierRenderAuthority(
	project: FramescaperProjectV28,
	deliveryRequest: FramescaperNativeRenderDeliveryRequestV28,
	outputRate: Readonly<{ readonly num: number; readonly den: number }>,
) {
	const delivery = createFramescaperNativeRenderPlanAuthorityV28(project, deliveryRequest);
	return Object.freeze({
		...delivery, outputRate, includeAudio: false, audioLayout: null,
		format: Object.freeze({ container: 'mp4' as const, extension: 'mp4' as const, mimeType: 'video/mp4' as const }),
		codecs: Object.freeze({
			video: 'h264', videoEncoder: 'libx264', audio: null, audioEncoder: null,
			pixelFormat: 'yuv420p',
		}),
		canvas: Object.freeze({ ...delivery.canvas, pixelFormat: 'yuv420p' }),
	});
}

export function framescaperNativeCarrierPlanningRateV28(
	value: Readonly<{ readonly num: number; readonly den: number }>,
): Readonly<{ readonly num: number; readonly den: number }> {
	return BigInt(value.num) > 30n * BigInt(value.den)
		? Object.freeze({ num: 30, den: 1 }) : value;
}

export function assertFramescaperNativeCarrierDispositionV28(
	plan: UnifiedExactRenderPlanV14,
	disposition: FramescaperVideoExportPictureDispositionV27,
): void {
	if (disposition.unexplainedOmittedNodeIds.length !== 0) {
		throw new Error('Selected V28 Web Core omitted inherited exact render nodes.');
	}
	const implementedNodeIds = plan.nodes.filter(
		({ kind }) => kind !== 'professional-media' && kind !== 'openfx',
	).map(({ nodeId }) => nodeId).sort();
	const dispositionNodeIds = disposition.nodeDispositions.map(({ nodeId }) => nodeId).sort();
	if (canonicalizeNativeMediaPlan(implementedNodeIds)
		!== canonicalizeNativeMediaPlan(dispositionNodeIds)) {
		throw new Error('Selected V28 Web carrier disposition does not cover its exact V13 semantic projection.');
	}
	const expected = plan.nodes.flatMap((node) => node.kind === 'openfx' && node.state.enabled
		? Array.from({ length: plan.output.frameCount }, (_, outputOrdinal) => (
			`${node.state.instanceId}\0${node.state.context}\0${String(outputOrdinal)}`
		)) : []).sort();
	const observed = (disposition.openFxDispositions ?? []).map((row) => (
		`${row.instanceId}\0${row.context}\0${String(row.outputOrdinal)}`
	)).sort();
	if (canonicalizeNativeMediaPlan(expected) !== canonicalizeNativeMediaPlan(observed)) {
		throw new Error('Selected V28 Web carrier OpenFX disposition does not cover every exact frame node.');
	}
	if (Boolean(disposition.reportsOpenFxDegradation)
		!== (disposition.openFxDispositions ?? []).some(({ reportsDegradation }) => reportsDegradation)) {
		throw new Error('Selected V28 Web carrier OpenFX degradation summary is contradictory.');
	}
}

export function assertFramescaperNativeCarrierPlanParityV28(
	v14: UnifiedExactRenderPlanV14,
	inherited: ProductVideoExportPlan,
): void {
	const canvas = framescaperNativeCarrierPictureCanvasV28(inherited);
	const codecs = record(inherited.codecs, 'selected V28 inherited picture codecs');
	const planningRate = framescaperNativeCarrierPlanningRateV28(v14.output.frameRate);
	if (inherited.range.startFrame !== v14.timebase.sampleStart
		|| inherited.range.durationFrames !== v14.timebase.sampleDuration
		|| canvas.width !== v14.output.canvas.width || canvas.height !== v14.output.canvas.height
		|| canvas.frameRate.num !== planningRate.num
		|| canvas.frameRate.den !== planningRate.den
		|| canvas.fit !== v14.output.canvas.fit
		|| canvas.backgroundColor.toLowerCase() !== v14.output.canvas.backgroundColor.toLowerCase()
		|| inherited.quality !== v14.output.quality || inherited.format !== 'mp4'
		|| codecs.video !== 'h264' || codecs.videoEncoder !== 'libx264'
		|| codecs.pixelFormat !== 'yuv420p' || codecs.audio !== null || codecs.audioEncoder !== null) {
		throw new Error('Selected V28 inherited Web picture plan diverges from immutable V14 output authority.');
	}
	const delivery = framescaperNativeRenderDeliveryRequestFromPlanV28(v14);
	const dispatch = nativeMediaV14EncodeDispatch(v14.deliveryProfile!);
	if (v14.format.container !== dispatch.muxer
		|| v14.codecs.videoEncoder !== dispatch.encoder
		|| v14.codecs.pixelFormat !== dispatch.pixelFormat
		|| v14.output.canvas.pixelFormat !== dispatch.pixelFormat
		|| (delivery.kind === 'image-sequence' && (!dispatch.imageSequence
			|| !dispatch.supportsAlpha || v14.output.canvas.backgroundColor !== '#00000000'))
		|| (delivery.kind === 'encoded-mov' && (dispatch.imageSequence
			|| v14.codecs.video !== 'prores'))) {
		throw new Error('Selected V28 native delivery lost its authenticated V14 profile tuple.');
	}
}

export function framescaperNativeCarrierPictureCanvasV28(plan: ProductVideoExportPlan): Readonly<{
	readonly width: number; readonly height: number;
	readonly frameRate: Readonly<{ readonly num: number; readonly den: number }>;
	readonly fit: 'contain' | 'cover' | 'stretch'; readonly backgroundColor: string;
}> {
	const canvas = record(plan.canvas, 'selected V28 inherited picture canvas');
	const frameRate = record(canvas.frameRate, 'selected V28 inherited picture cadence');
	if (!Number.isSafeInteger(canvas.width) || Number(canvas.width) < 1
		|| !Number.isSafeInteger(canvas.height) || Number(canvas.height) < 1
		|| !Number.isSafeInteger(frameRate.num) || Number(frameRate.num) < 1
		|| !Number.isSafeInteger(frameRate.den) || Number(frameRate.den) < 1
		|| !['contain', 'cover', 'stretch'].includes(String(canvas.fit))
		|| typeof canvas.backgroundColor !== 'string') {
		throw new TypeError('The selected V28 inherited picture canvas is invalid.');
	}
	return Object.freeze({
		width: Number(canvas.width), height: Number(canvas.height),
		frameRate: Object.freeze({ num: Number(frameRate.num), den: Number(frameRate.den) }),
		fit: canvas.fit as 'contain' | 'cover' | 'stretch', backgroundColor: canvas.backgroundColor,
	});
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as Record<string, unknown>;
}

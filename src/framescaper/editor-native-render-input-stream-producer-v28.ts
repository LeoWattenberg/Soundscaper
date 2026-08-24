/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ProductNativeRenderInputOperation } from '../common/editor/controller/product-native-render-input-authority.ts';
import { nativeRgbaFramePackV1ByteLength } from '../common/editor/native-rgba-frame-pack-v1-contract.ts';
import type { FramescaperNativeRgbaFramePackV1Sink } from './native-render-frame-pack-v1.ts';
import {
	framescaperNativeAudioCarrierV28ByteLength,
	streamFramescaperNativeAudioCarrierV28,
	type FramescaperNativeAudioCarrierStreamSinkV28,
	type FramescaperNativeAudioCarrierStreamResultV28,
} from './editor-native-render-audio-carrier-v28.ts';
import {
	admitFramescaperNativeRenderInputAuthorityV28,
	admitFramescaperNativeRenderInputRequestV28,
	assertFramescaperNativeRenderOperationCurrentV28,
	currentFramescaperNativeRenderPlanV28,
	currentFramescaperNativeRenderProjectV28,
} from './editor-native-render-input-admission-v28.ts';
import type {
	FramescaperNativeRenderInputProducerAuthorityV28,
	FramescaperNativeRenderInputProducerDependenciesV28,
	FramescaperNativeRenderInputRequestV28,
} from './editor-native-render-input-producer-v28.ts';
import {
	FRAMESCAPER_NATIVE_RENDER_INPUT_PRODUCER_DEPENDENCIES_V28,
	resolveFramescaperNativeRenderInputProducerDependenciesV28,
	streamFramescaperNativeRenderCarrierV28,
} from './editor-native-render-input-producer-v28.ts';
import { framescaperProjectV27FoundationShapeV28 } from './editor-project-v28-foundation.ts';

export interface FramescaperNativeRenderInputStreamV28 {
	readonly carrierByteLength: number;
	readonly audio: FramescaperNativeRenderAudioInputStreamV28 | null;
	readonly stream: (sink: FramescaperNativeRgbaFramePackV1Sink) => Promise<Readonly<{
		readonly byteLength: number;
		readonly sha256: string;
		readonly chunkCount: number;
	}>>;
}

export interface FramescaperNativeRenderAudioInputStreamV28 {
	readonly role: 'staged-audio-mix';
	readonly byteLength: number;
	readonly stream: (
		sink: FramescaperNativeAudioCarrierStreamSinkV28,
	) => Promise<FramescaperNativeAudioCarrierStreamResultV28>;
}

/** Reserve exact lengths first, then revalidate and render pixels only after queue claim. */
export function createFramescaperNativeRenderInputStreamProducerV28(
	profile: unknown,
	authorityValue: FramescaperNativeRenderInputProducerAuthorityV28,
	dependenciesValue: FramescaperNativeRenderInputProducerDependenciesV28 =
		FRAMESCAPER_NATIVE_RENDER_INPUT_PRODUCER_DEPENDENCIES_V28,
): (request: FramescaperNativeRenderInputRequestV28) => Promise<FramescaperNativeRenderInputStreamV28> {
	const authority = admitFramescaperNativeRenderInputAuthorityV28(authorityValue);
	const dependencies = resolveFramescaperNativeRenderInputProducerDependenciesV28(dependenciesValue);
	return async (requestValue) => {
		const request = admitFramescaperNativeRenderInputRequestV28(requestValue);
		const operation = authority.authority.begin();
		let plan: ReturnType<typeof currentFramescaperNativeRenderPlanV28>;
		let audioByteLength: number | null;
		try {
			assertFramescaperNativeRenderOperationCurrentV28(operation);
			const project = currentFramescaperNativeRenderProjectV28(profile, operation.project, request);
			plan = currentFramescaperNativeRenderPlanV28(profile, project, request);
			audioByteLength = plan.output.includeAudio
				? framescaperNativeAudioCarrierV28ByteLength(
					plan, framescaperProjectV27FoundationShapeV28(project),
				) : null;
			assertFramescaperNativeRenderOperationCurrentV28(operation);
		} catch (error) {
			return finishOperation(operation, error);
		}
		operation.finish();
		const carrierByteLength = nativeRgbaFramePackV1ByteLength({
			width: plan.output.canvas.width,
			height: plan.output.canvas.height,
			frameCount: plan.output.frameCount,
		});
		let used = false;
		let audioUsed = false;
		const audio: FramescaperNativeRenderAudioInputStreamV28 | null = audioByteLength === null ? null
			: Object.freeze({
				role: 'staged-audio-mix' as const,
				byteLength: audioByteLength,
				stream: async (sink: FramescaperNativeAudioCarrierStreamSinkV28) => {
					if (audioUsed) throw new Error('The selected V28 live audio producer is one-shot.');
					audioUsed = true;
					return withCurrentOperation(authority.authority.begin(), async (current) => {
						assertFramescaperNativeRenderOperationCurrentV28(current);
						const project = currentFramescaperNativeRenderProjectV28(
							profile, current.project, request,
						);
						const currentPlan = currentFramescaperNativeRenderPlanV28(profile, project, request);
						return streamFramescaperNativeAudioCarrierV28(
							currentPlan, framescaperProjectV27FoundationShapeV28(project), current, sink,
						);
					});
				},
			});
		return Object.freeze({
			carrierByteLength,
			audio,
			stream: async (sink: FramescaperNativeRgbaFramePackV1Sink) => {
				if (used) throw new Error('The selected V28 live carrier producer is one-shot.');
				used = true;
				return withCurrentOperation(authority.authority.begin(), async (current) => {
					assertFramescaperNativeRenderOperationCurrentV28(current);
					const project = currentFramescaperNativeRenderProjectV28(profile, current.project, request);
					const currentPlan = currentFramescaperNativeRenderPlanV28(profile, project, request);
					return streamFramescaperNativeRenderCarrierV28(
						currentPlan, project, authority.store, current, dependencies, sink,
					);
				});
			},
		});
	};
}

function finishOperation(operation: ProductNativeRenderInputOperation, primary: unknown): never {
	try {
		operation.finish();
	} catch (cleanup) {
		throw new AggregateError(
			[primary, cleanup], 'V28 live carrier operation and authority cleanup failed.', { cause: primary },
		);
	}
	throw primary;
}

async function withCurrentOperation<Result>(
	operation: ProductNativeRenderInputOperation,
	execute: (operation: ProductNativeRenderInputOperation) => Promise<Result>,
): Promise<Result> {
	let result: Result | undefined;
	let primary: unknown;
	try { result = await execute(operation); } catch (error) { primary = error; }
	let cleanup: unknown;
	try {
		operation.finish();
	} catch (error) {
		cleanup = error;
	}
	if (primary !== undefined || cleanup !== undefined) {
		if (primary === undefined) throw cleanup;
		if (cleanup === undefined) throw primary;
		throw new AggregateError(
			[primary, cleanup], 'V28 live carrier streaming and authority cleanup failed.', { cause: primary },
		);
	}
	if (result === undefined) throw new Error('V28 live carrier streaming returned no trailer.');
	return result;
}

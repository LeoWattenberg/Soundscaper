/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ProductNativeRenderInputOperation } from '../common/editor/controller/product-native-render-input-authority.ts';
import { nativeRgbaFramePackV1ByteLength } from '../common/editor/native-rgba-frame-pack-v1-contract.ts';
import type { FramescaperNativeRgbaFramePackV1Sink } from './native-render-frame-pack-v1.ts';
import {
	framescaperNativeAudioCarrierNativeMediaByteLength,
	streamFramescaperNativeAudioCarrierNativeMedia,
	type FramescaperNativeAudioCarrierStreamSinkNativeMedia,
	type FramescaperNativeAudioCarrierStreamResultNativeMedia,
} from './editor-native-render-audio-carrier.ts';
import {
	admitFramescaperNativeRenderInputAuthorityNativeMedia,
	admitFramescaperNativeRenderInputRequestNativeMedia,
	assertFramescaperNativeRenderOperationCurrentNativeMedia,
	currentFramescaperNativeRenderPlanNativeMedia,
	currentFramescaperNativeRenderProjectNativeMedia,
} from './editor-native-render-input-admission.ts';
import type {
	FramescaperNativeRenderInputProducerAuthorityNativeMedia,
	FramescaperNativeRenderInputProducerDependenciesNativeMedia,
	FramescaperNativeRenderInputRequestNativeMedia,
} from './editor-native-render-input-producer.ts';
import {
	FRAMESCAPER_NATIVE_RENDER_INPUT_PRODUCER_DEPENDENCIES_NATIVE_MEDIA,
	resolveFramescaperNativeRenderInputProducerDependenciesNativeMedia,
	streamFramescaperNativeRenderCarrierNativeMedia,
} from './editor-native-render-input-producer.ts';
import { framescaperProjectFinishingFoundationShapeNativeMedia } from './editor-project-native-media-foundation.ts';

export interface FramescaperNativeRenderInputStreamNativeMedia {
	readonly carrierByteLength: number;
	readonly audio: FramescaperNativeRenderAudioInputStreamNativeMedia | null;
	readonly stream: (sink: FramescaperNativeRgbaFramePackV1Sink) => Promise<Readonly<{
		readonly byteLength: number;
		readonly sha256: string;
		readonly chunkCount: number;
	}>>;
}

export interface FramescaperNativeRenderAudioInputStreamNativeMedia {
	readonly role: 'staged-audio-mix';
	readonly byteLength: number;
	readonly stream: (
		sink: FramescaperNativeAudioCarrierStreamSinkNativeMedia,
	) => Promise<FramescaperNativeAudioCarrierStreamResultNativeMedia>;
}

/** Reserve exact lengths first, then revalidate and render pixels only after queue claim. */
export function createFramescaperNativeRenderInputStreamProducerNativeMedia(
	profile: unknown,
	authorityValue: FramescaperNativeRenderInputProducerAuthorityNativeMedia,
	dependenciesValue: FramescaperNativeRenderInputProducerDependenciesNativeMedia =
		FRAMESCAPER_NATIVE_RENDER_INPUT_PRODUCER_DEPENDENCIES_NATIVE_MEDIA,
): (request: FramescaperNativeRenderInputRequestNativeMedia) => Promise<FramescaperNativeRenderInputStreamNativeMedia> {
	const authority = admitFramescaperNativeRenderInputAuthorityNativeMedia(authorityValue);
	const dependencies = resolveFramescaperNativeRenderInputProducerDependenciesNativeMedia(dependenciesValue);
	return async (requestValue) => {
		const request = admitFramescaperNativeRenderInputRequestNativeMedia(requestValue);
		const operation = authority.authority.begin();
		let plan: ReturnType<typeof currentFramescaperNativeRenderPlanNativeMedia>;
		let audioByteLength: number | null;
		try {
			assertFramescaperNativeRenderOperationCurrentNativeMedia(operation);
			const project = currentFramescaperNativeRenderProjectNativeMedia(profile, operation.project, request);
			plan = currentFramescaperNativeRenderPlanNativeMedia(profile, project, request);
			audioByteLength = plan.output.includeAudio
				? framescaperNativeAudioCarrierNativeMediaByteLength(
					plan, framescaperProjectFinishingFoundationShapeNativeMedia(project),
				) : null;
			assertFramescaperNativeRenderOperationCurrentNativeMedia(operation);
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
		const audio: FramescaperNativeRenderAudioInputStreamNativeMedia | null = audioByteLength === null ? null
			: Object.freeze({
				role: 'staged-audio-mix' as const,
				byteLength: audioByteLength,
				stream: async (sink: FramescaperNativeAudioCarrierStreamSinkNativeMedia) => {
					if (audioUsed) throw new Error('The selected nativeMedia live audio producer is one-shot.');
					audioUsed = true;
					return withCurrentOperation(authority.authority.begin(), async (current) => {
						assertFramescaperNativeRenderOperationCurrentNativeMedia(current);
						const project = currentFramescaperNativeRenderProjectNativeMedia(
							profile, current.project, request,
						);
						const currentPlan = currentFramescaperNativeRenderPlanNativeMedia(profile, project, request);
						return streamFramescaperNativeAudioCarrierNativeMedia(
							currentPlan, framescaperProjectFinishingFoundationShapeNativeMedia(project), current, sink,
						);
					});
				},
			});
		return Object.freeze({
			carrierByteLength,
			audio,
			stream: async (sink: FramescaperNativeRgbaFramePackV1Sink) => {
				if (used) throw new Error('The selected nativeMedia live carrier producer is one-shot.');
				used = true;
				return withCurrentOperation(authority.authority.begin(), async (current) => {
					assertFramescaperNativeRenderOperationCurrentNativeMedia(current);
					const project = currentFramescaperNativeRenderProjectNativeMedia(profile, current.project, request);
					const currentPlan = currentFramescaperNativeRenderPlanNativeMedia(profile, project, request);
					return streamFramescaperNativeRenderCarrierNativeMedia(
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
			[primary, cleanup], 'nativeMedia live carrier operation and authority cleanup failed.', { cause: primary },
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
			[primary, cleanup], 'nativeMedia live carrier streaming and authority cleanup failed.', { cause: primary },
		);
	}
	if (result === undefined) throw new Error('nativeMedia live carrier streaming returned no trailer.');
	return result;
}

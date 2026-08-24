/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ProductNativeRenderInputOperation } from './product-native-render-input-authority.ts';

type Sink = Parameters<NonNullable<ProductNativeRenderInputOperation['renderAudioToSink']>>[2];
type Result = Awaited<ReturnType<NonNullable<ProductNativeRenderInputOperation['renderAudioToSink']>>>;

interface RenderEngine {
	loadProject(project: Readonly<Record<string, unknown>>, sourceBuffers: unknown): void;
	renderMixToSink(options: Readonly<Record<string, unknown>>): Promise<Result>;
	dispose(): PromiseLike<unknown> | unknown;
}

export interface ProductNativeRenderAudioStreamDependencies {
	readonly sourceBuffers: unknown;
	readonly signal: AbortSignal;
	readonly assertCurrent: () => void;
	readonly createRenderEngine: () => RenderEngine;
	readonly prepareCommittedTimePitchCaches: (
		project: Readonly<Record<string, unknown>>, signal: AbortSignal,
	) => PromiseLike<unknown>;
}

/** Stream exact project PCM through the common bounded sink engine. */
export async function renderProductNativeAudioToSink(
	dependencies: ProductNativeRenderAudioStreamDependencies,
	project: Readonly<Record<string, unknown>>,
	range: Readonly<Record<string, unknown>>,
	sink: Sink,
): Promise<Result> {
	if (!(dependencies.signal instanceof AbortSignal) || typeof dependencies.assertCurrent !== 'function'
		|| typeof dependencies.createRenderEngine !== 'function'
		|| typeof dependencies.prepareCommittedTimePitchCaches !== 'function'
		|| !project || typeof project !== 'object' || Array.isArray(project)
		|| !range || typeof range !== 'object' || Array.isArray(range) || typeof sink !== 'function') {
		throw new TypeError('Native PCM streaming requires exact controller render authorities.');
	}
	dependencies.assertCurrent();
	await dependencies.prepareCommittedTimePitchCaches(project, dependencies.signal);
	dependencies.assertCurrent();
	const engine = dependencies.createRenderEngine();
	let primary: unknown;
	try {
		engine.loadProject(project, dependencies.sourceBuffers);
		const result = await engine.renderMixToSink({
			...range, sink, signal: dependencies.signal,
			maximumPendingChunks: 2, backpressureHighWaterChunks: 1,
		});
		dependencies.assertCurrent();
		return exactResult(result);
	} catch (error) {
		primary = error;
		throw error;
	} finally {
		try { await engine.dispose(); }
		catch (error) {
			if (primary !== undefined) throw new AggregateError(
				[primary, error], 'Native PCM streaming and render-engine cleanup failed.', { cause: primary },
			);
			throw error;
		}
	}
}

function exactResult(value: unknown): Result {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Native PCM streaming returned an invalid result.');
	}
	const row = value as Readonly<Record<string, unknown>>;
	for (const field of ['sampleRate', 'channelCount', 'frameCount', 'chunkCount'] as const) {
		if (!Number.isSafeInteger(row[field]) || Number(row[field]) < (field === 'chunkCount' ? 0 : 1)) {
			throw new TypeError('Native PCM streaming returned invalid geometry.');
		}
	}
	return Object.freeze({
		sampleRate: Number(row.sampleRate), channelCount: Number(row.channelCount),
		frameCount: Number(row.frameCount), chunkCount: Number(row.chunkCount),
	});
}

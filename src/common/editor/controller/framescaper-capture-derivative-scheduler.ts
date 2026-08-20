/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	FramescaperCaptureDerivativeRequest,
} from './framescaper-capture-canonical-publication.ts';

export const FRAMESCAPER_CAPTURE_MAXIMUM_FILMSTRIP_THUMBNAILS = 2_000;

type MaybePromise<Value> = PromiseLike<Value> | Value;

export interface FramescaperCaptureDerivativeSource extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly storageKey?: string;
	readonly kind: 'audio' | 'video';
}

export interface FramescaperCaptureDerivativeProject extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly sources: readonly FramescaperCaptureDerivativeSource[];
}

export interface FramescaperCaptureVideoDerivativeInput {
	readonly timestamp: number;
	readonly type: 'poster' | 'thumbnail';
	readonly blob: Blob;
	readonly metadata: Readonly<{
		readonly width: number;
		readonly height: number;
		readonly mimeType: string;
	}>;
}

export interface FramescaperCaptureVideoFrameCaptureOptions {
	readonly maximumWidth?: number;
	readonly maximumHeight?: number;
	readonly alpha?: boolean;
}

export interface FramescaperCaptureVideoFrame {
	readonly timestampSeconds: number;
	readonly width: number;
	readonly height: number;
	readonly mimeType: string;
	readonly blob: Blob;
}

export interface FramescaperCaptureVideoFrameExtractor {
	readonly metadata: Readonly<{
		readonly durationSeconds: number;
		readonly width: number;
		readonly height: number;
	}>;
	capture(
		timestampSeconds: number,
		options?: FramescaperCaptureVideoFrameCaptureOptions,
	): MaybePromise<FramescaperCaptureVideoFrame>;
	dispose(): MaybePromise<void>;
}

export interface FramescaperCaptureDerivativeStore {
	getSourceMetadata(storageKey: string): MaybePromise<unknown | null>;
	loadMediaAsset(storageKey: string): MaybePromise<Blob | null>;
	saveVideoDerivative(
		sourceId: string,
		input: FramescaperCaptureVideoDerivativeInput,
	): MaybePromise<unknown>;
}

export interface FramescaperCaptureDerivativeSchedulerOptions {
	/** Resolve the retained origin by ID even when another project is active. */
	readonly getOriginProject: (
		projectId: string,
	) => MaybePromise<FramescaperCaptureDerivativeProject | null>;
	readonly store: FramescaperCaptureDerivativeStore;
	readonly activateStoredSource: (
		source: FramescaperCaptureDerivativeSource,
		metadata: unknown,
		options: Readonly<{ readonly requireChunkStream: true }>,
	) => MaybePromise<unknown>;
	readonly activateVideoSource?: (
		source: FramescaperCaptureDerivativeSource,
	) => MaybePromise<unknown>;
	readonly createVideoFrameExtractor: (
		media: Blob,
	) => MaybePromise<FramescaperCaptureVideoFrameExtractor>;
	readonly videoThumbnailTimes: (
		durationSeconds: number,
		options: Readonly<{ readonly maximum: number }>,
	) => readonly number[];
	readonly scheduleProxy?: (
		request: FramescaperCaptureDerivativeRequest,
	) => MaybePromise<void>;
}

export type FramescaperCaptureDerivativeScheduler = (
	request: FramescaperCaptureDerivativeRequest,
) => Promise<void>;

/**
 * Run disposable post-commit work without mutating the committed document or
 * owning canonical-asset rollback. Every independent failure is delayed until
 * remaining source derivatives and the optional proxy seam have run.
 */
export function createFramescaperCaptureDerivativeScheduler(
	options: FramescaperCaptureDerivativeSchedulerOptions,
): FramescaperCaptureDerivativeScheduler {
	assertOptions(options);
	return schedule;

	async function schedule(request: FramescaperCaptureDerivativeRequest): Promise<void> {
		const sourceIds = captureSourceIds(request);
		const failures: unknown[] = [];
		let project: FramescaperCaptureDerivativeProject | null = null;
		try {
			project = normalizeOriginProject(
				await options.getOriginProject(request.projectId),
				request.projectId,
			);
		} catch (error) {
			failures.push(derivativeError(`origin project ${request.projectId} lookup`, error));
		}
		if (project) {
			for (const sourceId of sourceIds) {
				const source = ownedProjectSource(project, sourceId, failures);
				if (!source) continue;
				if (source.kind === 'audio') await generateAudioDerivative(options, source, failures);
				else await generateVideoDerivatives(options, source, failures);
			}
		}
		if (options.scheduleProxy) {
			try {
				await options.scheduleProxy(request);
			} catch (error) {
				failures.push(derivativeError('proxy scheduling', error));
			}
		}
		if (failures.length) {
			throw new AggregateError(
				failures,
				'Framescaper capture derivatives completed with failures.',
			);
		}
	}
}

async function generateAudioDerivative(
	options: FramescaperCaptureDerivativeSchedulerOptions,
	source: FramescaperCaptureDerivativeSource,
	failures: unknown[],
): Promise<void> {
	try {
		const storageKey = sourceStorageKey(source);
		const metadata = await options.store.getSourceMetadata(storageKey);
		if (!metadata) throw new ReferenceError(`Stored audio source ${storageKey} is unavailable.`);
		// Ordinary activation owns waveform generation, persistence, and runtime
		// cache registration. Capture publication does not duplicate that logic.
		await options.activateStoredSource(source, metadata, Object.freeze({ requireChunkStream: true }));
	} catch (error) {
		failures.push(derivativeError(`${source.id} waveform activation`, error));
	}
}

async function generateVideoDerivatives(
	options: FramescaperCaptureDerivativeSchedulerOptions,
	source: FramescaperCaptureDerivativeSource,
	failures: unknown[],
): Promise<void> {
	let extractor: FramescaperCaptureVideoFrameExtractor | null = null;
	try {
		const media = await options.store.loadMediaAsset(sourceStorageKey(source));
		if (!(media instanceof Blob)) {
			throw new ReferenceError(`Retained video source ${source.id} is unavailable.`);
		}
		// Pass the repository-owned Blob directly to browser decoding. This path
		// never reconstructs the recording from encoded capture fragments.
		extractor = await options.createVideoFrameExtractor(media);
		normalizeExtractor(extractor);
	} catch (error) {
		failures.push(derivativeError(`${source.id} video extractor setup`, error));
		if (extractor) await disposeExtractor(source, extractor, failures);
		return;
	}
	try {
		await generatePoster(options.store, source, extractor, failures);
		let times: readonly number[] = [];
		try {
			times = boundedThumbnailTimes(options, extractor);
		} catch (error) {
			failures.push(derivativeError(`${source.id} filmstrip plan`, error));
		}
		for (const timestamp of times) {
			await generateThumbnail(options.store, source, extractor, timestamp, failures);
		}
	} finally {
		await disposeExtractor(source, extractor, failures);
	}
	if (options.activateVideoSource) {
		try {
			await options.activateVideoSource(source);
		} catch (error) {
			failures.push(derivativeError(`${source.id} video activation`, error));
		}
	}
}

async function disposeExtractor(
	source: FramescaperCaptureDerivativeSource,
	extractor: FramescaperCaptureVideoFrameExtractor,
	failures: unknown[],
): Promise<void> {
	try {
		await extractor.dispose();
	} catch (error) {
		failures.push(derivativeError(`${source.id} extractor cleanup`, error));
	}
}

async function generatePoster(
	store: FramescaperCaptureDerivativeStore,
	source: FramescaperCaptureDerivativeSource,
	extractor: FramescaperCaptureVideoFrameExtractor,
	failures: unknown[],
): Promise<void> {
	try {
		const poster = normalizeFrame(await extractor.capture(0, Object.freeze({
			maximumWidth: 640,
			maximumHeight: 360,
			alpha: sourceReportsAlpha(source),
		})));
		await store.saveVideoDerivative(sourceStorageKey(source), videoDerivative('poster', 0, poster));
	} catch (error) {
		failures.push(derivativeError(`${source.id} poster`, error));
	}
}

async function generateThumbnail(
	store: FramescaperCaptureDerivativeStore,
	source: FramescaperCaptureDerivativeSource,
	extractor: FramescaperCaptureVideoFrameExtractor,
	timestamp: number,
	failures: unknown[],
): Promise<void> {
	try {
		const thumbnail = normalizeFrame(await extractor.capture(timestamp, Object.freeze({
			alpha: sourceReportsAlpha(source),
		})));
		await store.saveVideoDerivative(
			sourceStorageKey(source),
			videoDerivative('thumbnail', thumbnail.timestampSeconds, thumbnail),
		);
	} catch (error) {
		failures.push(derivativeError(
			`${source.id} thumbnail at ${timestamp} seconds`,
			error,
		));
	}
}

function boundedThumbnailTimes(
	options: FramescaperCaptureDerivativeSchedulerOptions,
	extractor: FramescaperCaptureVideoFrameExtractor,
): readonly number[] {
	const durationSeconds = nonNegativeFinite(
		extractor.metadata.durationSeconds,
		'Video duration',
	);
	const requested = options.videoThumbnailTimes(durationSeconds, Object.freeze({
		maximum: FRAMESCAPER_CAPTURE_MAXIMUM_FILMSTRIP_THUMBNAILS,
	}));
	if (!Array.isArray(requested)) throw new TypeError('Video thumbnail times must be an array.');
	return Object.freeze(requested
		.slice(0, FRAMESCAPER_CAPTURE_MAXIMUM_FILMSTRIP_THUMBNAILS)
		.map((timestamp) => nonNegativeFinite(timestamp, 'Video thumbnail timestamp')));
}

function videoDerivative(
	type: 'poster' | 'thumbnail',
	timestamp: number,
	frame: FramescaperCaptureVideoFrame,
): Readonly<FramescaperCaptureVideoDerivativeInput> {
	return Object.freeze({
		timestamp,
		type,
		blob: frame.blob,
		metadata: Object.freeze({
			width: frame.width,
			height: frame.height,
			mimeType: frame.mimeType,
		}),
	});
}

function normalizeFrame(value: FramescaperCaptureVideoFrame): FramescaperCaptureVideoFrame {
	if (!value || typeof value !== 'object' || !(value.blob instanceof Blob)) {
		throw new TypeError('Video frame capture returned an invalid Blob.');
	}
	const timestampSeconds = nonNegativeFinite(value.timestampSeconds, 'Captured video timestamp');
	const width = positiveInteger(value.width, 'Captured video width');
	const height = positiveInteger(value.height, 'Captured video height');
	const mimeType = nonEmptyText(value.mimeType || value.blob.type, 'Captured video MIME type');
	return Object.freeze({ timestampSeconds, width, height, mimeType, blob: value.blob });
}

function normalizeExtractor(
	value: FramescaperCaptureVideoFrameExtractor,
): FramescaperCaptureVideoFrameExtractor {
	if (!value || typeof value !== 'object' || typeof value.capture !== 'function'
		|| typeof value.dispose !== 'function' || !value.metadata
		|| typeof value.metadata !== 'object') {
		throw new TypeError('A browser video frame extractor is required.');
	}
	return value;
}

function captureSourceIds(request: FramescaperCaptureDerivativeRequest): readonly string[] {
	if (!request || typeof request !== 'object') {
		throw new TypeError('A capture derivative request is required.');
	}
	nonEmptyText(request.projectId, 'Capture derivative project ID');
	nonEmptyText(request.sessionId, 'Capture derivative session ID');
	if (!Array.isArray(request.sourceIds) || request.sourceIds.length < 1
		|| request.sourceIds.length > 4) {
		throw new RangeError('Capture derivatives require one through four source IDs.');
	}
	const sourceIds = request.sourceIds.map((sourceId) => (
		nonEmptyText(sourceId, 'Capture derivative source ID')
	));
	if (new Set(sourceIds).size !== sourceIds.length) {
		throw new RangeError('Capture derivative source IDs must be unique.');
	}
	const planned = request.plan?.entries?.map(({ sourceId }) => sourceId);
	if (!Array.isArray(planned) || planned.length !== sourceIds.length
		|| planned.some((sourceId, index) => sourceId !== sourceIds[index])) {
		throw new Error('Capture derivative source ownership does not match its publication plan.');
	}
	return Object.freeze(sourceIds);
}

function normalizeOriginProject(
	value: FramescaperCaptureDerivativeProject | null,
	expectedId: string,
): FramescaperCaptureDerivativeProject {
	if (!value || typeof value !== 'object' || value.id !== expectedId
		|| !Array.isArray(value.sources)) {
		throw new ReferenceError(`Committed origin project ${expectedId} is unavailable.`);
	}
	return value;
}

function ownedProjectSource(
	project: FramescaperCaptureDerivativeProject,
	sourceId: string,
	failures: unknown[],
): FramescaperCaptureDerivativeSource | null {
	const matches = project.sources.filter((source) => source?.id === sourceId);
	if (matches.length !== 1) {
		failures.push(derivativeError(
			`${sourceId} project ownership`,
			new ReferenceError(`Committed capture source ${sourceId} is missing or ambiguous.`),
		));
		return null;
	}
	const source = matches[0]!;
	if (source.kind !== 'audio' && source.kind !== 'video') {
		failures.push(derivativeError(
			`${sourceId} source kind`,
			new TypeError(`Committed capture source ${sourceId} has an invalid kind.`),
		));
		return null;
	}
	return source;
}

function sourceStorageKey(source: FramescaperCaptureDerivativeSource): string {
	return nonEmptyText(source.storageKey ?? source.id, `${source.id} storage key`);
}

function sourceReportsAlpha(source: FramescaperCaptureDerivativeSource): boolean {
	const characteristics = source.characteristics;
	return Boolean(characteristics && typeof characteristics === 'object'
		&& !Array.isArray(characteristics)
		&& (characteristics as Readonly<Record<string, unknown>>).hasAlpha === true);
}

function derivativeError(operation: string, cause: unknown): Error {
	return new Error(`Framescaper capture ${operation} derivative failed.`, { cause });
}

function assertOptions(options: FramescaperCaptureDerivativeSchedulerOptions): void {
	if (!options || typeof options !== 'object'
		|| typeof options.getOriginProject !== 'function'
		|| typeof options.activateStoredSource !== 'function'
		|| (options.activateVideoSource !== undefined && typeof options.activateVideoSource !== 'function')
		|| typeof options.createVideoFrameExtractor !== 'function'
		|| typeof options.videoThumbnailTimes !== 'function'
		|| !options.store || typeof options.store !== 'object'
		|| typeof options.store.getSourceMetadata !== 'function'
		|| typeof options.store.loadMediaAsset !== 'function'
		|| typeof options.store.saveVideoDerivative !== 'function'
		|| (options.scheduleProxy !== undefined && typeof options.scheduleProxy !== 'function')) {
		throw new TypeError('Complete Framescaper capture derivative scheduler ports are required.');
	}
}

function nonEmptyText(value: unknown, name: string): string {
	const text = typeof value === 'string' ? value.trim() : '';
	if (!text) throw new TypeError(`${name} is required.`);
	return text;
}

function nonNegativeFinite(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		throw new RangeError(`${name} must be a non-negative finite number.`);
	}
	return Object.is(value, -0) ? 0 : value;
}

function positiveInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return Number(value);
}

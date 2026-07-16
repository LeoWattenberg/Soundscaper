/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	STAFFPAD_ALGORITHM_ID,
	STAFFPAD_ALGORITHM_VERSION,
	STAFFPAD_MAXIMUM_RENDER_BYTES,
	STAFFPAD_MAXIMUM_RATIO,
	STAFFPAD_MINIMUM_PITCH_CENTS,
	STAFFPAD_MINIMUM_RATIO,
	STAFFPAD_MAXIMUM_PITCH_CENTS,
	StaffPadRenderClient,
	normalizeStaffPadTransform,
	pitchCentsToRatio,
	staffPadTransformOutputFrames,
} from './staffpad/index.js';
import { AUDIO_EDITOR_SOURCE_CHUNK_FRAMES } from './project-v2.js';

export const CLIP_TIME_PITCH_CACHE_SCHEMA_VERSION = 1;
export const CLIP_TIME_PITCH_CACHE_ALGORITHM_REVISION = STAFFPAD_ALGORITHM_VERSION;
export const CLIP_TIME_PITCH_CACHE_PREFIX = 'audio-editor-time-pitch-v1';
export const CLIP_TIME_PITCH_DEFAULT_RESIDENT_CHANNEL_BYTES = 32 * 1024 ** 2;

const MAXIMUM_SEQUENTIAL_STAGES = 32;

export function clipNeedsTimePitchRender(clip) {
	if (!clip || typeof clip !== 'object') return false;
	return Number(clip.pitchCents ?? 0) !== 0 || Number(clip.speedRatio ?? 1) !== 1;
}

/** A stable error surface for UI, worker, and quota reporting. */
export class ClipTimePitchCacheError extends Error {
	constructor(code, message, options = {}) {
		super(message, options.cause ? { cause: options.cause } : undefined);
		this.name = 'ClipTimePitchCacheError';
		this.code = String(code || 'RENDER_FAILED');
		this.details = options.details == null ? null : cloneJson(options.details);
	}
}

/**
 * Validate one V2 clip/source pair and split extreme speed changes into scalar
 * StaffPad passes. The native ABI remains within 0.5–2.0 on every pass while
 * the browser model keeps accepting any finite positive clip speed.
 */
export function describeClipTimePitchRender(clip, source, options = {}) {
	if (!clip || typeof clip !== 'object' || Array.isArray(clip)) {
		throw new TypeError('A V2 audio clip is required.');
	}
	if (!source || typeof source !== 'object' || Array.isArray(source)) {
		throw new TypeError('A V2 audio source is required.');
	}
	const sourceId = nonEmptyString(source.id, 'source.id');
	if (nonEmptyString(clip.sourceId, 'clip.sourceId') !== sourceId) {
		throw cacheError('SOURCE_MISMATCH', 'The clip does not reference the supplied immutable source.');
	}
	const clipId = nonEmptyString(clip.id, 'clip.id');
	const sourceFrameCount = positiveInteger(source.frameCount, 'source.frameCount');
	const sourceStartFrame = nonNegativeInteger(clip.sourceStartFrame ?? 0, 'clip.sourceStartFrame');
	const sourceDurationFrames = positiveInteger(
		clip.sourceDurationFrames ?? clip.durationFrames,
		'clip.sourceDurationFrames',
	);
	if (sourceStartFrame + sourceDurationFrames > sourceFrameCount) {
		throw cacheError('INVALID_SOURCE_RANGE', 'The clip source range extends beyond its immutable source.');
	}
	const channelCount = integerRange(source.channelCount, 1, 2, 'source.channelCount');
	const sampleRate = integerRange(
		options.sampleRate ?? source.sampleRate,
		8_000,
		192_000,
		'sampleRate',
	);
	const pitchCents = finiteRange(
		clip.pitchCents ?? 0,
		STAFFPAD_MINIMUM_PITCH_CENTS,
		STAFFPAD_MAXIMUM_PITCH_CENTS,
		'clip.pitchCents',
	);
	const speedRatio = positiveFinite(clip.speedRatio ?? 1, 'clip.speedRatio');
	const preserveFormants = Boolean(clip.preserveFormants);
	const direction = clip.reversed ? 'reverse' : 'forward';
	const renderCacheRevision = nonNegativeInteger(
		clip.renderCacheRevision ?? 0,
		'clip.renderCacheRevision',
	);
	const algorithmRevision = nonEmptyString(
		options.algorithmRevision ?? CLIP_TIME_PITCH_CACHE_ALGORITHM_REVISION,
		'algorithmRevision',
	);
	const speedStages = decomposeSpeedRatio(speedRatio);
	let inputFrames = sourceDurationFrames;
	const stages = speedStages.map((tempoRatio, index) => {
		const stagePitchCents = index === 0 ? pitchCents : 0;
		const transform = normalizeStaffPadTransform({
			tempoRatio,
			pitchRatio: pitchCentsToRatio(stagePitchCents),
			preserveFormants: index === 0 && preserveFormants,
		});
		const outputFrames = staffPadTransformOutputFrames(inputFrames, transform);
		const stage = Object.freeze({
			index,
			inputFrames,
			outputFrames,
			tempoRatio,
			pitchCents: stagePitchCents,
			preserveFormants: transform.preserveFormants,
			transform: freezeTransform(transform),
		});
		inputFrames = outputFrames;
		return stage;
	});
	const outputFrames = stages.at(-1).outputFrames;
	const outputBytes = outputFrames * channelCount * Float32Array.BYTES_PER_ELEMENT;
	const maximumOutputBytes = options.maximumOutputBytes ?? STAFFPAD_MAXIMUM_RENDER_BYTES;
	const largestStageBytes = stages.reduce((largest, stage) => (
		Math.max(largest, stage.outputFrames * channelCount * Float32Array.BYTES_PER_ELEMENT)
	), 0);
	if (!Number.isSafeInteger(outputBytes) || !Number.isSafeInteger(largestStageBytes)
		|| largestStageBytes > maximumOutputBytes) {
		throw cacheError(
			'OUTPUT_LIMIT_EXCEEDED',
			`The clip render would exceed the ${maximumOutputBytes} byte output limit.`,
			{ outputFrames, outputBytes, largestStageBytes },
		);
	}
	const warnings = [];
	if (speedRatio < STAFFPAD_MINIMUM_RATIO || speedRatio > STAFFPAD_MAXIMUM_RATIO) {
		warnings.push(Object.freeze({
			code: 'STAFFPAD_TIME_RATIO_OUTSIDE_TESTED_RANGE',
			message: `The ${speedRatio}:1 clip speed is outside StaffPad's best-tested 0.5–2.0 range; ${stages.length} sequential passes will be used.`,
			speedRatio,
			stageCount: stages.length,
		}));
	}
	return Object.freeze({
		schemaVersion: CLIP_TIME_PITCH_CACHE_SCHEMA_VERSION,
		clipId,
		sourceId,
		storageKey: nonEmptyString(source.storageKey || sourceId, 'source.storageKey'),
		sourceFrameCount,
		sourceRange: Object.freeze({ startFrame: sourceStartFrame, frameCount: sourceDurationFrames }),
		channelCount,
		sampleRate,
		direction,
		pitchCents,
		speedRatio,
		preserveFormants,
		renderCacheRevision,
		algorithmRevision,
		outputFrames,
		outputBytes,
		stages: Object.freeze(stages),
		warnings: Object.freeze(warnings),
		sourceIdentity: Object.freeze({
			id: sourceId,
			storageKey: nonEmptyString(source.storageKey || sourceId, 'source.storageKey'),
			frameCount: sourceFrameCount,
			channelCount,
			sampleRate,
			sampleFormat: String(source.sampleFormat || 'float32'),
			revision: sourceRevision(source),
		}),
	});
}

/** Derive the immutable, sequential stage keys without reading source PCM. */
export async function deriveClipTimePitchCachePlan(clip, source, options = {}) {
	const description = describeClipTimePitchRender(clip, source, options);
	let priorKey = null;
	const stages = [];
	for (const stage of description.stages) {
		const descriptor = Object.freeze({
			schemaVersion: CLIP_TIME_PITCH_CACHE_SCHEMA_VERSION,
			algorithm: Object.freeze({
				id: STAFFPAD_ALGORITHM_ID,
				revision: description.algorithmRevision,
			}),
			input: priorKey == null
				? Object.freeze({
					source: description.sourceIdentity,
					range: description.sourceRange,
					direction: description.direction,
				})
				: Object.freeze({
					cacheKey: priorKey,
					range: Object.freeze({ startFrame: 0, frameCount: stage.inputFrames }),
					direction: 'forward',
				}),
			intent: Object.freeze({
				pitchCents: description.pitchCents,
				speedRatio: description.speedRatio,
				preserveFormants: description.preserveFormants,
				renderCacheRevision: description.renderCacheRevision,
			}),
			sampleRate: description.sampleRate,
			channelCount: description.channelCount,
			stage: Object.freeze({
				index: stage.index,
				count: description.stages.length,
				inputFrames: stage.inputFrames,
				outputFrames: stage.outputFrames,
				transform: stage.transform,
			}),
		});
		const cacheKey = await hashCacheDescriptor(descriptor);
		stages.push(Object.freeze({ ...stage, descriptor, cacheKey }));
		priorKey = cacheKey;
	}
	const finalKey = priorKey;
	return Object.freeze({
		...description,
		stages: Object.freeze(stages),
		finalKey,
		cacheSourceId: cacheSourceIdForKey(finalKey),
	});
}

/**
 * Coordinates immutable StaffPad renders and their atomic source-store commit.
 * A clip may retain its previous committed entry while a newer revision runs.
 */
export class ClipTimePitchRenderCacheCoordinator {
	constructor(options = {}) {
		if (!options.store?.beginSourceWrite || !options.store?.getSourceMetadata) {
			throw new TypeError('A project store with source persistence is required.');
		}
		this.store = options.store;
		this.client = options.client || new StaffPadRenderClient(options.staffPadClientOptions);
		if (!this.client?.render) throw new TypeError('A StaffPad render client is required.');
		this.ownsClient = !options.client;
		this.chunkFrames = integerRange(
			options.chunkFrames ?? AUDIO_EDITOR_SOURCE_CHUNK_FRAMES,
			1_024,
			AUDIO_EDITOR_SOURCE_CHUNK_FRAMES,
			'chunkFrames',
		);
		this.maximumOutputBytes = positiveInteger(
			options.maximumOutputBytes ?? STAFFPAD_MAXIMUM_RENDER_BYTES,
			'maximumOutputBytes',
		);
		this.requiredQuotaHeadroomBytes = nonNegativeInteger(
			options.requiredQuotaHeadroomBytes ?? 0,
			'requiredQuotaHeadroomBytes',
		);
		const customSourceLoader = typeof options.loadSourceChannels === 'function';
		this.loadSourceChannels = options.loadSourceChannels || ((source, context) => (
			loadStoredSourceChannels(this.store, source, context)
		));
		this.transferLoadedSourceChannels = options.transferLoadedSourceChannels == null
			? !customSourceLoader
			: Boolean(options.transferLoadedSourceChannels);
		this.maximumResidentChannelBytes = nonNegativeInteger(
			options.maximumResidentChannelBytes ?? CLIP_TIME_PITCH_DEFAULT_RESIDENT_CHANNEL_BYTES,
			'maximumResidentChannelBytes',
		);
		this.residentChannelBytes = 0;
		this.residentChannelsByKey = new Map();
		this.onWarning = typeof options.onWarning === 'function' ? options.onWarning : null;
		this.committedByKey = new Map();
		this.lastCommittedByClip = new Map();
		this.desiredByClip = new Map();
		this.requestSequence = 0;
		this.inFlight = new Map();
		this.disposed = false;
	}

	describe(clip, source, options = {}) {
		return describeClipTimePitchRender(clip, source, {
			...options,
			maximumOutputBytes: options.maximumOutputBytes ?? this.maximumOutputBytes,
		});
	}

	async plan(clip, source, options = {}) {
		return deriveClipTimePitchCachePlan(clip, source, {
			...options,
			maximumOutputBytes: options.maximumOutputBytes ?? this.maximumOutputBytes,
		});
	}

	/**
	 * Begin or join an exact render. `current` is the last valid committed cache
	 * for this clip and remains usable until `pending` publishes atomically.
	 */
	async requestClipRender(clip, source, options = {}) {
		this.#assertActive();
		throwIfAborted(options.signal);
		const plan = await this.plan(clip, source, options);
		throwIfAborted(options.signal);
		for (const warning of plan.warnings) this.onWarning?.(warning, { clip, source, plan });
		const sequence = ++this.requestSequence;
		this.desiredByClip.set(plan.clipId, { key: plan.finalKey, sequence });
		const exact = await this.#findCommitted(plan);
		throwIfAborted(options.signal);
		if (exact) {
			this.#publishForClip(plan.clipId, sequence, exact);
			return Object.freeze({
				plan,
				current: exact,
				committed: exact,
				pending: Promise.resolve(exact),
				warnings: plan.warnings,
			});
		}
		const current = this.lastCommittedByClip.get(plan.clipId)?.entry || null;
		const job = this.#getOrCreateJob(plan, clip, source, options);
		job.interests.set(plan.clipId, Math.max(sequence, job.interests.get(plan.clipId) || 0));
		const pending = this.#subscribe(job, options.signal);
		// A stale-playback caller may intentionally ignore the refresh promise.
		// Registering a rejection observer prevents an expected abort from becoming
		// a global unhandled-rejection while preserving the original promise API.
		pending.catch(() => undefined);
		return Object.freeze({
			plan,
			current,
			committed: null,
			pending,
			warnings: plan.warnings,
		});
	}

	/** Playback may use the prior cache during regeneration, but never raw-rate fallback. */
	async resolveForPlayback(clip, source, options = {}) {
		const request = await this.requestClipRender(clip, source, options);
		if (request.committed) return resolvedEntry(request.committed, request, false);
		if (request.current) return resolvedEntry(request.current, request, true);
		return resolvedEntry(await request.pending, request, false);
	}

	/** Export and first playback wait for the requested revision's atomic commit. */
	async prepareCommittedOutput(clip, source, options = {}) {
		const request = await this.requestClipRender(clip, source, options);
		const entry = request.committed || await request.pending;
		if (entry.cacheKey !== request.plan.finalKey) {
			throw cacheError('STALE_COMMIT', 'The requested clip render did not publish the expected immutable cache key.');
		}
		return entry;
	}

	getLastValid(clipId) {
		const entry = this.lastCommittedByClip.get(String(clipId))?.entry || null;
		this.#touchResidentChannels(entry);
		return entry;
	}

	getCommitted(cacheKey) {
		const entry = this.committedByKey.get(String(cacheKey)) || null;
		this.#touchResidentChannels(entry);
		return entry;
	}

	getResidentChannelBytes() {
		return this.residentChannelBytes;
	}

	getProtectedSourceIds() {
		return new Set([
			...[...this.committedByKey.values()].map((entry) => entry.cacheSourceId),
			...[...this.inFlight.keys()].map(cacheSourceIdForKey),
		]);
	}

	/** Drop clip mappings and cache entries which are no longer live in the project. */
	retainClipIds(clipIds) {
		const retained = new Set(Array.from(clipIds || [], String));
		for (const clipId of this.lastCommittedByClip.keys()) {
			if (!retained.has(clipId)) this.lastCommittedByClip.delete(clipId);
		}
		for (const clipId of this.desiredByClip.keys()) {
			if (!retained.has(clipId)) this.desiredByClip.delete(clipId);
		}
		for (const job of this.inFlight.values()) {
			for (const clipId of job.interests.keys()) {
				if (!retained.has(clipId)) job.interests.delete(clipId);
			}
			if (job.interests.size === 0) job.controller.abort();
		}
		this.#discardUnreferencedEntries();
		return this.getProtectedSourceIds();
	}

	/** Reset one controller session without disposing its long-lived StaffPad worker. */
	clear() {
		for (const job of this.inFlight.values()) {
			job.interests.clear();
			job.controller.abort();
		}
		this.inFlight.clear();
		this.committedByKey.clear();
		this.lastCommittedByClip.clear();
		this.desiredByClip.clear();
		this.residentChannelsByKey.clear();
		this.residentChannelBytes = 0;
	}

	/** Read persisted cache PCM without requiring an AudioContext. */
	async loadCommittedChannels(entryOrKey, options = {}) {
		const entry = typeof entryOrKey === 'string'
			? this.committedByKey.get(entryOrKey)
			: entryOrKey;
		if (!entry?.cacheSourceId) throw cacheError('CACHE_MISS', 'The committed clip cache could not be found.');
		if (entry.channels) {
			this.#touchResidentChannels(entry);
			return entry.channels.map((channel) => channel.slice());
		}
		return loadStoredSourceChannels(this.store, {
			id: entry.cacheSourceId,
			storageKey: entry.cacheSourceId,
			frameCount: entry.frameCount,
			channelCount: entry.channelCount,
			sampleRate: entry.sampleRate,
		}, options);
	}

	/** Attach an AudioBuffer (or compatible object) for the optional engine hook. */
	attachAudioBuffer(cacheKey, buffer) {
		const entry = this.committedByKey.get(String(cacheKey));
		if (!entry) throw cacheError('CACHE_MISS', 'The committed clip cache could not be found.');
		if (!isAudioBufferLike(buffer)) throw new TypeError('A non-empty AudioBuffer-compatible cache is required.');
		if (buffer.length !== entry.frameCount || buffer.numberOfChannels !== entry.channelCount) {
			throw cacheError('BUFFER_MISMATCH', 'The AudioBuffer does not match the committed clip cache.');
		}
		// The committed source on disk is canonical. Keeping planar output beside
		// an AudioBuffer doubles the cache's resident PCM without helping playback.
		this.#releaseResidentChannels(entry);
		entry.audioBuffer = buffer;
		return entry;
	}

	/**
	 * Return a synchronous engine resolver. Only a committed AudioBuffer is
	 * substituted; unresolved clips continue through the engine's normal Map.
	 */
	createEngineSourceResolver() {
		return (clip) => {
			if (!clipNeedsTimePitchRender(clip)) return null;
			const entry = this.lastCommittedByClip.get(String(clip?.id))?.entry;
			if (!entry?.audioBuffer) return null;
			return {
				buffer: entry.audioBuffer,
				sourceStartFrame: 0,
				sourceDurationFrames: entry.frameCount,
				reversed: false,
			};
		};
	}

	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		this.clear();
		if (this.ownsClient) this.client.dispose?.();
	}

	#assertActive() {
		if (this.disposed) throw cacheError('DISPOSED', 'The clip time-and-pitch cache coordinator is disposed.');
	}

	async #findCommitted(plan) {
		const memoryEntry = this.committedByKey.get(plan.finalKey);
		if (memoryEntry) {
			this.#touchResidentChannels(memoryEntry);
			return memoryEntry;
		}
		const metadata = await this.store.getSourceMetadata(plan.cacheSourceId);
		if (!metadata || metadata.cacheKey !== plan.finalKey
			|| metadata.cacheSchemaVersion !== CLIP_TIME_PITCH_CACHE_SCHEMA_VERSION
			|| metadata.algorithmRevision !== plan.algorithmRevision
			|| Number(metadata.frameCount ?? metadata.frameLength) !== plan.outputFrames
			|| Number(metadata.channelCount) !== plan.channelCount
			|| Number(metadata.sampleRate) !== plan.sampleRate) return null;
		const entry = createCommittedEntry(plan, metadata);
		this.committedByKey.set(plan.finalKey, entry);
		return entry;
	}

	#getOrCreateJob(plan, clip, source, options) {
		let job = this.inFlight.get(plan.finalKey);
		if (job) return job;
		const controller = new AbortController();
		job = {
			key: plan.finalKey,
			controller,
			interests: new Map(),
			subscribers: new Set(),
			settled: false,
			result: null,
			error: null,
		};
		this.inFlight.set(plan.finalKey, job);
		job.promise = this.#renderAndCommit(plan, clip, source, {
			...options,
			signal: controller.signal,
		}).then((entry) => {
			job.result = entry;
			this.committedByKey.set(plan.finalKey, entry);
			for (const [clipId, sequence] of job.interests) this.#publishForClip(clipId, sequence, entry);
			return entry;
		}, (error) => {
			job.error = normalizeCacheError(error);
			throw job.error;
		}).finally(() => {
			job.settled = true;
			this.inFlight.delete(plan.finalKey);
		});
		job.promise.catch(() => undefined);
		return job;
	}

	#subscribe(job, signal) {
		throwIfAborted(signal);
		return new Promise((resolve, reject) => {
			const subscriber = { resolve, reject, signal, onAbort: null, settled: false };
			const finish = (error, value) => {
				if (subscriber.settled) return;
				subscriber.settled = true;
				job.subscribers.delete(subscriber);
				if (signal && subscriber.onAbort) signal.removeEventListener('abort', subscriber.onAbort);
				if (error) reject(error);
				else resolve(value);
			};
			subscriber.onAbort = () => {
				finish(abortError());
				if (!job.settled && job.subscribers.size === 0) job.controller.abort();
			};
			job.subscribers.add(subscriber);
			if (signal) signal.addEventListener('abort', subscriber.onAbort, { once: true });
			if (signal?.aborted) subscriber.onAbort();
			job.promise.then((value) => finish(null, value), (error) => finish(error));
		});
	}

	#publishForClip(clipId, sequence, entry) {
		const previous = this.lastCommittedByClip.get(clipId);
		if (previous && previous.sequence > sequence) return;
		this.lastCommittedByClip.set(clipId, { sequence, entry });
		this.#discardUnreferencedEntries();
	}

	#discardUnreferencedEntries() {
		const retainedKeys = new Set(this.inFlight.keys());
		for (const value of this.lastCommittedByClip.values()) retainedKeys.add(value.entry.cacheKey);
		for (const cacheKey of this.committedByKey.keys()) {
			if (!retainedKeys.has(cacheKey)) {
				this.#releaseResidentChannels(this.committedByKey.get(cacheKey));
				this.committedByKey.delete(cacheKey);
			}
		}
	}

	#retainResidentChannels(entry, channels) {
		const bytes = channels.reduce((sum, channel) => sum + channel.byteLength, 0);
		this.#releaseResidentChannels(entry);
		if (bytes > this.maximumResidentChannelBytes) return;
		while (this.residentChannelBytes + bytes > this.maximumResidentChannelBytes) {
			const oldest = this.residentChannelsByKey.values().next().value;
			if (!oldest) break;
			this.#releaseResidentChannels(oldest.entry);
		}
		entry.channels = channels;
		this.residentChannelsByKey.set(entry.cacheKey, { entry, bytes });
		this.residentChannelBytes += bytes;
	}

	#releaseResidentChannels(entry) {
		if (!entry) return;
		const resident = this.residentChannelsByKey.get(entry.cacheKey);
		if (resident?.entry === entry) {
			this.residentChannelsByKey.delete(entry.cacheKey);
			this.residentChannelBytes -= resident.bytes;
		}
		entry.channels = null;
	}

	#touchResidentChannels(entry) {
		if (!entry?.channels) return;
		const resident = this.residentChannelsByKey.get(entry.cacheKey);
		if (resident?.entry !== entry) return;
		this.residentChannelsByKey.delete(entry.cacheKey);
		this.residentChannelsByKey.set(entry.cacheKey, resident);
	}

	async #renderAndCommit(plan, clip, source, options) {
		throwIfAborted(options.signal);
		await assertQuota(this.store, plan.outputBytes, this.requiredQuotaHeadroomBytes);
		let channels = normalizeLoadedChannels(
			await this.loadSourceChannels(source, { signal: options.signal, clip, plan }),
			plan,
		);
		let ownsChannels = this.transferLoadedSourceChannels;
		throwIfAborted(options.signal);
		let selection = plan.direction === 'reverse'
			? {
				startFrame: plan.sourceFrameCount - plan.sourceRange.startFrame - plan.sourceRange.frameCount,
				frameCount: plan.sourceRange.frameCount,
			}
			: { ...plan.sourceRange };
		if (plan.direction === 'reverse') {
			channels = channels.map(reverseFloat32);
			ownsChannels = true;
		}
		for (const stage of plan.stages) {
			throwIfAborted(options.signal);
			const result = await this.client.render({
				channels,
				sampleRate: plan.sampleRate,
				selection,
				transform: stage.transform,
				outputFrames: stage.outputFrames,
				chunkFrames: Math.min(65_536, Math.max(1_024, this.chunkFrames)),
			}, {
				signal: options.signal,
				cacheKey: stage.cacheKey,
				// Stored-source arrays and prior-stage output are coordinator-owned.
				// Transfer them into the worker instead of structured-cloning a second
				// full copy. Custom loader output remains borrowed unless opted in.
				transferInput: ownsChannels,
				onProgress: typeof options.onProgress === 'function'
					? (progress) => options.onProgress(
						(stage.index + Math.max(0, Math.min(1, Number(progress) || 0))) / plan.stages.length,
						{ stage: stage.index, stageCount: plan.stages.length, cacheKey: stage.cacheKey },
					)
					: null,
			});
			channels = validateRenderedChannels(result?.channels, plan.channelCount, stage.outputFrames);
			ownsChannels = true;
			selection = { startFrame: 0, frameCount: stage.outputFrames };
		}
		throwIfAborted(options.signal);
		const writer = await this.store.beginSourceWrite(plan.cacheSourceId, {
			name: `${clip.title || clip.name || 'Clip'} (StaffPad cache)`,
			mimeType: 'audio/x-kw-staffpad-cache',
			sampleRate: plan.sampleRate,
			channelCount: plan.channelCount,
			cacheKey: plan.finalKey,
			cacheSchemaVersion: CLIP_TIME_PITCH_CACHE_SCHEMA_VERSION,
			algorithmRevision: plan.algorithmRevision,
			sourceId: plan.sourceId,
			renderCacheRevision: plan.renderCacheRevision,
		});
		try {
			for (let start = 0; start < plan.outputFrames; start += this.chunkFrames) {
				throwIfAborted(options.signal);
				const end = Math.min(plan.outputFrames, start + this.chunkFrames);
				await writer.write(channels.map((channel) => channel.subarray(start, end)));
			}
			throwIfAborted(options.signal);
			const metadata = await writer.commit({
				frameCount: plan.outputFrames,
				outputBytes: plan.outputBytes,
			});
			const entry = createCommittedEntry(plan, metadata);
			this.#retainResidentChannels(entry, channels);
			return entry;
		} catch (error) {
			await writer.abort().catch(() => undefined);
			throw normalizeCacheError(error);
		}
	}
}

/** Load one immutable source into planar arrays through the store's chunk API. */
export async function loadStoredSourceChannels(store, source, options = {}) {
	if (!store?.readSourceChunks) throw new TypeError('The project store cannot read source chunks.');
	const frameCount = positiveInteger(source.frameCount, 'source.frameCount');
	const channelCount = integerRange(source.channelCount, 1, 2, 'source.channelCount');
	const channels = Array.from({ length: channelCount }, () => new Float32Array(frameCount));
	let offset = 0;
	for await (const chunk of store.readSourceChunks(source.storageKey || source.id)) {
		throwIfAborted(options.signal);
		if (!Array.isArray(chunk.channels) || chunk.channels.length !== channelCount) {
			throw cacheError('CORRUPT_SOURCE', 'A stored source chunk has an invalid channel count.');
		}
		const frames = positiveInteger(chunk.frames ?? chunk.channels[0]?.length, 'source chunk frames');
		if (offset + frames > frameCount) throw cacheError('CORRUPT_SOURCE', 'Stored source chunks exceed their declared frame count.');
		for (let channel = 0; channel < channelCount; channel += 1) {
			if (!(chunk.channels[channel] instanceof Float32Array) || chunk.channels[channel].length !== frames) {
				throw cacheError('CORRUPT_SOURCE', 'A stored source chunk contains invalid planar PCM.');
			}
			channels[channel].set(chunk.channels[channel], offset);
		}
		offset += frames;
	}
	if (offset !== frameCount) throw cacheError('CORRUPT_SOURCE', 'Stored source chunks do not match their declared frame count.');
	return channels;
}

export function cacheSourceIdForKey(cacheKey) {
	const match = /^audio-editor-time-pitch-v1:([0-9a-f]{64})$/.exec(String(cacheKey));
	if (!match) throw new TypeError('A clip time-and-pitch cache key is required.');
	return `${CLIP_TIME_PITCH_CACHE_PREFIX}-${match[1]}`;
}

function resolvedEntry(entry, request, stale) {
	return Object.freeze({
		...entry,
		stale,
		desiredCacheKey: request.plan.finalKey,
		warnings: request.warnings,
		pending: stale ? request.pending : Promise.resolve(entry),
	});
}

function createCommittedEntry(plan, metadata) {
	return {
		cacheKey: plan.finalKey,
		cacheSourceId: plan.cacheSourceId,
		algorithmRevision: plan.algorithmRevision,
		sourceId: plan.sourceId,
		renderCacheRevision: plan.renderCacheRevision,
		sampleRate: plan.sampleRate,
		channelCount: plan.channelCount,
		frameCount: plan.outputFrames,
		direction: plan.direction,
		metadata: Object.freeze(cloneJson(metadata)),
		channels: null,
		audioBuffer: null,
		committedAt: String(metadata.committedAt || new Date().toISOString()),
	};
}

function normalizeLoadedChannels(value, plan) {
	const channels = isAudioBufferLike(value)
		? Array.from({ length: value.numberOfChannels }, (_, channel) => value.getChannelData(channel))
		: value;
	if (!Array.isArray(channels) || channels.length !== plan.channelCount) {
		throw cacheError('SOURCE_CHANNEL_MISMATCH', 'Loaded source PCM does not match the V2 source channel count.');
	}
	return channels.map((channel, index) => {
		if (!(channel instanceof Float32Array) || channel.length !== plan.sourceFrameCount) {
			throw cacheError('SOURCE_FRAME_MISMATCH', `Loaded source channel ${index} does not match the V2 source frame count.`);
		}
		return channel;
	});
}

function validateRenderedChannels(channels, channelCount, frameCount) {
	if (!Array.isArray(channels) || channels.length !== channelCount) {
		throw cacheError('INVALID_RENDER_OUTPUT', 'StaffPad returned an invalid channel count.');
	}
	return channels.map((channel, index) => {
		if (!(channel instanceof Float32Array) || channel.length !== frameCount) {
			throw cacheError('INVALID_RENDER_OUTPUT', `StaffPad returned an invalid channel ${index}.`);
		}
		return channel;
	});
}

function decomposeSpeedRatio(value) {
	let remaining = positiveFinite(value, 'clip.speedRatio');
	const stages = [];
	for (let index = 0; index < MAXIMUM_SEQUENTIAL_STAGES; index += 1) {
		if (remaining > STAFFPAD_MAXIMUM_RATIO) {
			stages.push(STAFFPAD_MAXIMUM_RATIO);
			remaining /= STAFFPAD_MAXIMUM_RATIO;
			continue;
		}
		if (remaining < STAFFPAD_MINIMUM_RATIO) {
			stages.push(STAFFPAD_MINIMUM_RATIO);
			remaining /= STAFFPAD_MINIMUM_RATIO;
			continue;
		}
		stages.push(remaining);
		return stages;
	}
	throw cacheError('SPEED_RATIO_LIMIT_EXCEEDED', 'The clip speed requires too many sequential StaffPad passes.');
}

async function hashCacheDescriptor(descriptor) {
	if (!globalThis.crypto?.subtle) throw cacheError('HASH_UNAVAILABLE', 'SHA-256 is unavailable for clip render cache keys.');
	const bytes = new TextEncoder().encode(stableSerialize(descriptor));
	const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
	const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
	return `${CLIP_TIME_PITCH_CACHE_PREFIX}:${hash}`;
}

async function assertQuota(store, outputBytes, headroomBytes) {
	if (typeof store.estimateStorage !== 'function') return;
	const estimate = await store.estimateStorage();
	if (estimate?.usage == null || estimate?.quota == null) return;
	const usage = Number(estimate?.usage);
	const quota = Number(estimate?.quota);
	if (!Number.isFinite(usage) || !Number.isFinite(quota)) return;
	const required = outputBytes + headroomBytes;
	if (quota - usage < required) {
		throw cacheError('QUOTA_EXCEEDED', 'There is not enough browser storage to commit the clip render.', {
			usage,
			quota,
			available: Math.max(0, quota - usage),
			required,
		});
	}
}

function normalizeCacheError(error) {
	if (error instanceof ClipTimePitchCacheError) return error;
	if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR' || error?.code === 'ABORTED') return abortError();
	if (error?.name === 'QuotaExceededError' || error?.code === 'QuotaExceededError'
		|| error?.code === 'QUOTA_EXCEEDED' || error?.code === 22) {
		return cacheError('QUOTA_EXCEEDED', 'Browser storage quota was exceeded before the clip render could be committed.', null, error);
	}
	return cacheError('RENDER_FAILED', error?.message || 'The StaffPad clip render failed.', null, error);
}

function cacheError(code, message, details = null, cause = null) {
	return new ClipTimePitchCacheError(code, message, { details, cause });
}

function abortError() {
	const error = new ClipTimePitchCacheError('ABORTED', 'The clip time-and-pitch render was cancelled.');
	error.name = 'AbortError';
	return error;
}

function throwIfAborted(signal) {
	if (signal?.aborted) throw abortError();
}

function reverseFloat32(input) {
	const output = new Float32Array(input.length);
	for (let index = 0; index < input.length; index += 1) output[index] = input[input.length - index - 1];
	return output;
}

function sourceRevision(source) {
	const value = source.revision ?? source.opaqueExtensions?.revision ?? source.opaqueExtensions?.sourceRevision ?? 0;
	return nonNegativeInteger(value, 'source revision');
}

function freezeTransform(transform) {
	return Object.freeze({
		preserveFormants: transform.preserveFormants,
		durationRatio: transform.durationRatio,
		keyframes: Object.freeze(transform.keyframes.map((keyframe) => Object.freeze({ ...keyframe }))),
	});
}

function isAudioBufferLike(value) {
	return Boolean(value && Number.isSafeInteger(value.numberOfChannels) && value.numberOfChannels > 0
		&& Number.isSafeInteger(value.length) && value.length > 0
		&& typeof value.getChannelData === 'function');
}

function stableSerialize(value) {
	if (value === null || typeof value !== 'object') return JSON.stringify(Object.is(value, -0) ? 0 : value);
	if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
	return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
}

function cloneJson(value) {
	if (value == null) return value;
	if (typeof structuredClone === 'function') return structuredClone(value);
	return JSON.parse(JSON.stringify(value));
}

function nonEmptyString(value, name) {
	const result = String(value ?? '').trim();
	if (!result) throw new TypeError(`${name} must be a non-empty string.`);
	return result;
}

function positiveFinite(value, name) {
	const number = Number(value);
	if (!Number.isFinite(number) || number <= 0) throw new RangeError(`${name} must be finite and positive.`);
	return number;
}

function finiteRange(value, minimum, maximum, name) {
	const number = Number(value);
	if (!Number.isFinite(number) || number < minimum || number > maximum) {
		throw new RangeError(`${name} must be between ${minimum} and ${maximum}.`);
	}
	return number;
}

function positiveInteger(value, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number <= 0) throw new RangeError(`${name} must be a positive safe integer.`);
	return number;
}

function nonNegativeInteger(value, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 0) throw new RangeError(`${name} must be a non-negative safe integer.`);
	return number;
}

function integerRange(value, minimum, maximum, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
		throw new RangeError(`${name} must be an integer between ${minimum} and ${maximum}.`);
	}
	return number;
}

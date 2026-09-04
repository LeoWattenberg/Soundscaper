/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	STAFFPAD_MAXIMUM_RENDER_BYTES,
	StaffPadRenderClient,
} from './staffpad/index.js';
import { AUDIO_EDITOR_SOURCE_CHUNK_FRAMES } from './project-audio-factory.js';
import { checkedPublicationByteSum, estimatePcmRenderPublication } from './publication-byte-estimates.ts';
import { estimateClipTimePitchRenderAdmission, normalizeClipTimePitchRenderMaximumBytes } from './clip-time-pitch-render-admission.ts';
import {
	isAudioBufferLike,
	loadStoredSourceChannels,
	normalizeLoadedChannels,
	validateRenderedChannels,
} from './clip-time-pitch-cache-channels.js';
import {
	abortError,
	cacheError,
	normalizeCacheError,
	throwIfAborted,
} from './clip-time-pitch-cache-errors.js';
import {
	CLIP_TIME_PITCH_CACHE_SCHEMA_VERSION,
	cacheSourceIdForKey,
	clipNeedsTimePitchRender,
	deriveClipTimePitchCachePlan,
	describeClipTimePitchRender,
} from './clip-time-pitch-cache-plan.js';
import { ClipTimePitchCacheSessionFence } from './clip-time-pitch-cache-session.ts';
import { cloneJson, reverseFloat32 } from './clip-time-pitch-cache-values.ts';
import {
	integerRange,
	nonNegativeInteger,
	positiveInteger,
} from './clip-time-pitch-cache-validation.ts';

export { ClipTimePitchCacheError } from './clip-time-pitch-cache-errors.js';
export { loadStoredSourceChannels } from './clip-time-pitch-cache-channels.js';
export {
	CLIP_TIME_PITCH_CACHE_ALGORITHM_REVISION,
	CLIP_TIME_PITCH_CACHE_PREFIX,
	CLIP_TIME_PITCH_CACHE_SCHEMA_VERSION,
	cacheSourceIdForKey,
	clipNeedsTimePitchRender,
	deriveClipTimePitchCachePlan,
	describeClipTimePitchRender,
} from './clip-time-pitch-cache-plan.js';

export const CLIP_TIME_PITCH_DEFAULT_RESIDENT_CHANNEL_BYTES = 32 * 1024 ** 2;

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
		this.maximumRenderWorkingBytes = normalizeClipTimePitchRenderMaximumBytes(options.maximumRenderWorkingBytes);
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
		this.renderTail = Promise.resolve();
		this.sessionFence = new ClipTimePitchCacheSessionFence({
			createAbortError: abortError,
			createDisposedError: () => cacheError(
				'DISPOSED', 'The clip time-and-pitch cache coordinator is disposed.',
			),
		});
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
		const sessionEpoch = this.sessionFence.capture();
		throwIfAborted(options.signal);
		const plan = await this.plan(clip, source, options);
		this.#assertSession(sessionEpoch);
		throwIfAborted(options.signal);
		for (const warning of plan.warnings) this.onWarning?.(warning, { clip, source, plan });
		this.#assertSession(sessionEpoch);
		const sequence = ++this.requestSequence;
		this.desiredByClip.set(plan.clipId, { key: plan.finalKey, sequence });
		const exact = await this.#findCommitted(plan, sessionEpoch);
		this.#assertSession(sessionEpoch);
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

	/** Reset one controller session and drain work that was already in flight. */
	clear() {
		return this.sessionFence.clear(this.inFlight.values(), () => this.#resetSessionState());
	}

	#resetSessionState() {
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
		return this.sessionFence.dispose(
			this.inFlight.values(),
			() => this.#resetSessionState(),
			this.ownsClient ? () => this.client.dispose?.() : undefined,
		);
	}

	#assertActive() {
		this.sessionFence.assertActive();
	}

	#assertSession(sessionEpoch) {
		this.sessionFence.assertCurrent(sessionEpoch);
	}

	async #findCommitted(plan, sessionEpoch) {
		const memoryEntry = this.committedByKey.get(plan.finalKey);
		if (memoryEntry) {
			this.#touchResidentChannels(memoryEntry);
			return memoryEntry;
		}
		const metadata = await this.store.getSourceMetadata(plan.cacheSourceId);
		this.#assertSession(sessionEpoch);
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
		if (job?.controller.signal.aborted) job = null;
		if (job) return job;
		const controller = new AbortController();
		job = {
			key: plan.finalKey,
			sessionEpoch: this.sessionFence.capture(),
			controller,
			interests: new Map(),
			subscribers: new Set(),
			settled: false,
			result: null,
			error: null,
		};
		this.inFlight.set(plan.finalKey, job);
		const render = this.renderTail.then(() => this.#renderAndCommit(plan, clip, source, {
			...options,
			signal: controller.signal,
		}));
		this.renderTail = render.then(() => undefined, () => undefined);
		job.promise = render.then((entry) => {
			this.#assertSession(job.sessionEpoch);
			throwIfAborted(job.controller.signal);
			job.result = entry;
			this.committedByKey.set(plan.finalKey, entry);
			for (const [clipId, sequence] of job.interests) this.#publishForClip(clipId, sequence, entry);
			return entry;
		}, (error) => {
			job.error = normalizeCacheError(error);
			throw job.error;
		}).finally(() => {
			job.settled = true;
			if (this.inFlight.get(plan.finalKey) === job) this.inFlight.delete(plan.finalKey);
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
		const { bytes: peakWorkingBytes, scope } = estimateClipTimePitchRenderAdmission(plan, {
			chunkFrames: this.chunkFrames, transferLoadedSourceChannels: this.transferLoadedSourceChannels,
		}).usefulBinaryWorkingSet;
		if (peakWorkingBytes > this.maximumRenderWorkingBytes) throw cacheError(
			'RENDER_MEMORY_LIMIT_EXCEEDED',
			`The StaffPad clip render would exceed the ${this.maximumRenderWorkingBytes} byte working-set limit.`,
			{ limitBytes: this.maximumRenderWorkingBytes, peakWorkingBytes, scope },
		);
		await assertQuota(this.store, plan, this.chunkFrames, this.requiredQuotaHeadroomBytes);
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
			chunkFrames: this.chunkFrames,
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
			}, { signal: options.signal });
			throwIfAborted(options.signal);
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


async function assertQuota(store, plan, chunkFrames, headroomBytes) {
	if (typeof store.estimateStorage !== 'function') return;
	const estimate = await store.estimateStorage();
	if (estimate?.usage == null || estimate?.quota == null) return;
	const usage = Number(estimate?.usage);
	const quota = Number(estimate?.quota);
	if (!Number.isFinite(usage) || !Number.isFinite(quota)) return;
	const required = checkedPublicationByteSum(estimatePcmRenderPublication({ frameCount: plan.outputFrames, channelCount: plan.channelCount, chunkFrames }).binaryPayload.bytes, headroomBytes);
	if (quota - usage < required) {
		throw cacheError('QUOTA_EXCEEDED', 'There is not enough browser storage to commit the clip render.', {
			usage,
			quota,
			available: Math.max(0, quota - usage),
			required,
		});
	}
}


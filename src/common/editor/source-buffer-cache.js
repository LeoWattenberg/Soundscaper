const FLOAT32_BYTES_PER_SAMPLE = Float32Array.BYTES_PER_ELEMENT;

export const DEFAULT_SOURCE_BUFFER_CACHE_MAX_BYTES = 256 * 1024 * 1024;

/**
 * Estimate the planar PCM memory owned by an AudioBuffer-compatible value.
 * Browser AudioBuffers expose Float32 channel data, so their useful payload is
 * `length * numberOfChannels * 4` bytes. Browser/runtime object overhead is not
 * included in this deliberately predictable budget.
 */
export function estimateAudioBufferBytes(value) {
	const length = value?.length;
	const numberOfChannels = value?.numberOfChannels;
	if (!Number.isSafeInteger(length) || length < 0) {
		throw new TypeError('Cached audio buffers must have a non-negative integer length.');
	}
	if (!Number.isSafeInteger(numberOfChannels) || numberOfChannels < 0) {
		throw new TypeError('Cached audio buffers must have a non-negative integer numberOfChannels.');
	}
	const bytes = length * numberOfChannels * FLOAT32_BYTES_PER_SAMPLE;
	if (!Number.isSafeInteger(bytes)) {
		throw new RangeError('The estimated audio-buffer byte length exceeds the safe integer range.');
	}
	return bytes;
}

/**
 * A Map-compatible, least-recently-used cache with a hard byte budget.
 *
 * Iteration follows Map insertion order, which is least-recently-used to
 * most-recently-used here. `get()` refreshes an entry; `peek()` does not.
 * The default `oversize: 'reject'` policy never lets `byteLength` exceed
 * `maxBytes`. With the explicit `oversize: 'allow'` policy, a single most
 * recently set entry may exceed the budget and all other entries are evicted.
 *
 * `onRemove` observes every removal. `onEvict` observes only automatic budget
 * removals (`capacity` and `resize`), which is useful for cache telemetry and
 * for integration code that needs to react when a resident buffer is released.
 */
export class SourceBufferCache extends Map {
	#entryBytes = new Map();
	#byteLength = 0;
	#maxBytes;
	#estimateBytes;
	#onEvict;
	#onRemove;
	#oversize;

	constructor({
		maxBytes = DEFAULT_SOURCE_BUFFER_CACHE_MAX_BYTES,
		estimateBytes = estimateAudioBufferBytes,
		onEvict = null,
		onRemove = null,
		oversize = 'reject',
		entries = [],
	} = {}) {
		super();
		this.#maxBytes = validByteLimit(maxBytes, 'maxBytes');
		if (typeof estimateBytes !== 'function') throw new TypeError('estimateBytes must be a function.');
		if (onEvict != null && typeof onEvict !== 'function') throw new TypeError('onEvict must be a function.');
		if (onRemove != null && typeof onRemove !== 'function') throw new TypeError('onRemove must be a function.');
		if (oversize !== 'reject' && oversize !== 'allow') {
			throw new TypeError("oversize must be either 'reject' or 'allow'.");
		}
		this.#estimateBytes = estimateBytes;
		this.#onEvict = onEvict;
		this.#onRemove = onRemove;
		this.#oversize = oversize;
		for (const [key, value] of entries) this.set(key, value);
	}

	get byteLength() {
		return this.#byteLength;
	}

	get maxBytes() {
		return this.#maxBytes;
	}

	set maxBytes(value) {
		this.setMaxBytes(value);
	}

	get oversizePolicy() {
		return this.#oversize;
	}

	/** Return a cached value without changing its LRU position. */
	peek(key) {
		return super.get(key);
	}

	get(key) {
		if (!super.has(key)) return undefined;
		const value = super.get(key);
		super.delete(key);
		super.set(key, value);
		return value;
	}

	/** Return whether a value is individually eligible for this cache. */
	canFit(value) {
		return this.#measure(value) <= this.#maxBytes || this.#oversize === 'allow';
	}

	/**
	 * Cache a value only when it is individually eligible. Unlike `set()`, this
	 * returns false instead of throwing when the strict policy rejects an
	 * oversized value. Estimator/validation failures are still reported.
	 */
	setIfFits(key, value) {
		const bytes = this.#measure(value);
		if (bytes > this.#maxBytes && this.#oversize === 'reject') return false;
		this.#setMeasured(key, value, bytes);
		return true;
	}

	set(key, value) {
		const bytes = this.#measure(value);
		if (bytes > this.#maxBytes && this.#oversize === 'reject') {
			throw new RangeError(`Cache entry requires ${bytes} bytes but maxBytes is ${this.#maxBytes}.`);
		}
		this.#setMeasured(key, value, bytes);
		return this;
	}

	delete(key) {
		if (!super.has(key)) return false;
		const event = this.#remove(key, 'delete');
		this.#notify([event]);
		return true;
	}

	clear() {
		if (super.size === 0) return;
		const events = [];
		for (const [key, value] of super.entries()) {
			events.push(removalEvent(key, value, this.#entryBytes.get(key), 'clear'));
		}
		super.clear();
		this.#entryBytes.clear();
		this.#byteLength = 0;
		this.#notify(events);
	}

	setMaxBytes(value) {
		const maxBytes = validByteLimit(value, 'maxBytes');
		if (maxBytes === this.#maxBytes) return this;
		this.#maxBytes = maxBytes;
		const events = this.#trim('resize');
		this.#notify(events);
		return this;
	}

	#setMeasured(key, value, bytes) {
		const events = [];
		if (super.has(key)) events.push(this.#remove(key, 'replace'));
		super.set(key, value);
		this.#entryBytes.set(key, bytes);
		this.#byteLength += bytes;
		events.push(...this.#trim('capacity'));
		this.#notify(events);
	}

	#trim(reason) {
		const events = [];
		while (this.#byteLength > this.#maxBytes && super.size > 0) {
			if (this.#oversize === 'allow' && super.size === 1) break;
			const oldestKey = super.keys().next().value;
			events.push(this.#remove(oldestKey, reason));
		}
		return events;
	}

	#remove(key, reason) {
		const value = super.get(key);
		const bytes = this.#entryBytes.get(key);
		super.delete(key);
		this.#entryBytes.delete(key);
		this.#byteLength -= bytes;
		return removalEvent(key, value, bytes, reason);
	}

	#measure(value) {
		return validByteLimit(this.#estimateBytes(value), 'estimateBytes result');
	}

	#notify(events) {
		for (const event of events) {
			this.#onRemove?.(event);
			if (event.reason === 'capacity' || event.reason === 'resize') this.#onEvict?.(event);
		}
	}
}

export function createSourceBufferCache(options) {
	return new SourceBufferCache(options);
}

function validByteLimit(value, label) {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new TypeError(`${label} must be a non-negative safe integer.`);
	}
	return value;
}

function removalEvent(key, value, bytes, reason) {
	return Object.freeze({ key, value, bytes, reason });
}

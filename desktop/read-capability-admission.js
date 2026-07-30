/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	MAX_SCAPE_RANGE_READ_CAPABILITIES,
	MAX_SCAPE_RANGE_READ_CAPABILITY_BYTES,
} from './constants.js';

export class ReadCapabilityAdmissionError extends RangeError {
	constructor(message, { retryable = false } = {}) {
		super(message);
		this.name = 'ReadCapabilityAdmissionError';
		this.retryable = retryable === true;
	}
}

export function isRetryableReadCapabilityAdmissionError(error) {
	return error instanceof ReadCapabilityAdmissionError && error.retryable;
}

export class ScapeRangeReadAdmission {
	#activeRequest = null;
	#bytes = 0;
	#count = 0;
	#fenced = false;
	#maximumBytes;
	#maximumCount;
	#ownerStates = new WeakMap();

	constructor({
		maximumCount = MAX_SCAPE_RANGE_READ_CAPABILITIES,
		maximumBytes = MAX_SCAPE_RANGE_READ_CAPABILITY_BYTES,
	} = {}) {
		this.#maximumCount = boundedReadLimit(
			maximumCount,
			MAX_SCAPE_RANGE_READ_CAPABILITIES,
			'Scape range capability count',
			{ allowZero: false },
		);
		this.#maximumBytes = boundedReadLimit(
			maximumBytes,
			MAX_SCAPE_RANGE_READ_CAPABILITY_BYTES,
			'Scape range capability aggregate bytes',
		);
	}

	reserve(owner) {
		if (this.#fenced) throw new Error('Scape range admission is fenced after a cleanup failure');
		let state = this.#ownerStates.get(owner);
		if (!state) {
			state = { bytes: 0, count: 0 };
			this.#ownerStates.set(owner, state);
		}
		if (this.#count >= this.#maximumCount || state.count >= this.#maximumCount) {
			throw new ReadCapabilityAdmissionError(
				`Scape range capability count exceeds the limit of ${this.#maximumCount}`,
				{ retryable: true },
			);
		}
		this.#count += 1;
		state.count += 1;
		return { bytes: 0, charged: false, released: false, retained: false, state };
	}

	charge(ticket, size) {
		assertLiveTicket(ticket);
		if (ticket.charged) throw new Error('Scape range capability was already charged');
		if (size > this.#maximumBytes) {
			throw new ReadCapabilityAdmissionError(
				`Scape range capability bytes exceed the limit of ${this.#maximumBytes}`,
			);
		}
		if (size > this.#maximumBytes - this.#bytes
			|| size > this.#maximumBytes - ticket.state.bytes) {
			throw new ReadCapabilityAdmissionError(
				`Scape range capability bytes exceed the limit of ${this.#maximumBytes}`,
				{ retryable: true },
			);
		}
		ticket.bytes = size;
		ticket.charged = true;
		this.#bytes += size;
		ticket.state.bytes += size;
	}

	release(ticket) {
		if (!ticket || ticket.released || ticket.retained) return;
		ticket.released = true;
		this.#count -= 1;
		ticket.state.count -= 1;
		if (ticket.charged) {
			this.#bytes -= ticket.bytes;
			ticket.state.bytes -= ticket.bytes;
		}
	}

	retainAndFence(ticket) {
		if (!ticket || ticket.released || ticket.retained) return;
		ticket.retained = true;
		this.#fenced = true;
	}

	acquireRequest(ticket) {
		assertLiveTicket(ticket);
		if (this.#activeRequest) return null;
		let released = false;
		const request = Object.freeze({
			release: () => {
				if (released) return;
				released = true;
				if (this.#activeRequest === request) this.#activeRequest = null;
			},
		});
		this.#activeRequest = request;
		return request;
	}
}

function assertLiveTicket(ticket) {
	if (!ticket || ticket.released || ticket.retained) {
		throw new Error('Scape range capability admission is not active');
	}
}

export function boundedReadLimit(value, maximum, label, { allowZero = true } = {}) {
	if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > maximum) {
		throw new RangeError(`${label} must be ${allowZero ? 'a non-negative' : 'a positive'} integer no greater than ${maximum}`);
	}
	return value;
}

export function safeReadFileSize(value) {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new RangeError('Selected file size must be a non-negative safe integer');
	}
	return value;
}

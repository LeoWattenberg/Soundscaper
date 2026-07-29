/* SPDX-License-Identifier: AGPL-3.0-only */

/** Owns the single renderer document generation currently allowed to save. */
export class RendererSaveOwnership {
	#active = null;

	activate(binding) {
		const validated = validateActivation(binding);
		const revokedOwner = this.#active?.owner ?? null;
		const owner = Object.freeze(Object.create(null));
		this.#active = {
			webContents: validated.webContents,
			processId: validated.processId,
			frameId: validated.frameId,
			owner,
		};
		return Object.freeze({ owner, revokedOwner });
	}

	ownerFor(binding) {
		const validated = validateIpcBinding(binding);
		const active = this.#active;
		if (
			!active
			|| active.webContents !== validated.sender
			|| active.processId !== validated.processId
			|| active.frameId !== validated.frameId
		) {
			throw new Error('Save request did not originate from the active renderer document');
		}
		return active.owner;
	}

	currentOwnerFor(webContents) {
		const validated = reference(webContents, 'WebContents');
		if (!this.#active || this.#active.webContents !== validated) {
			throw new Error('No active renderer document owner is available');
		}
		return this.#active.owner;
	}

	revoke(webContents) {
		const validated = reference(webContents, 'WebContents');
		if (this.#active?.webContents !== validated) return null;
		const owner = this.#active.owner;
		this.#active = null;
		return owner;
	}
}

function validateActivation(binding) {
	if (!binding || typeof binding !== 'object') {
		throw new TypeError('Renderer save activation requires a document binding');
	}
	return {
		webContents: reference(binding.webContents, 'WebContents'),
		processId: processId(binding.processId),
		frameId: frameId(binding.frameId),
	};
}

function validateIpcBinding(binding) {
	if (!binding || typeof binding !== 'object') {
		throw new TypeError('Renderer save admission requires an IPC binding');
	}
	return {
		sender: reference(binding.sender, 'IPC sender'),
		processId: processId(binding.processId),
		frameId: frameId(binding.frameId),
	};
}

function reference(value, label) {
	if ((typeof value !== 'object' || value === null) && typeof value !== 'function') {
		throw new TypeError(`Renderer save ${label} must be an object reference`);
	}
	return value;
}

function processId(value) {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new RangeError('Renderer save processId must be a positive integer');
	}
	return value;
}

function frameId(value) {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new RangeError('Renderer save frameId must be a non-negative integer');
	}
	return value;
}

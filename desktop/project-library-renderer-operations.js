/* SPDX-License-Identifier: AGPL-3.0-only */

/** Owns cancellation and draining for every renderer-scoped library operation. */
export class RendererProjectLibraryOperations {
	#disposed = false;
	#owners = new WeakMap();
	#states = new Set();

	admit(owner, operation) {
		if (this.#disposed) return Promise.reject(new Error('Renderer project-library operations were disposed'));
		const state = this.#state(reference(owner));
		if (state.revoked) return Promise.reject(new Error('Renderer project-library owner was revoked'));
		let admitted;
		try {
			admitted = Promise.resolve(operation(state.controller.signal)).then((value) => {
				if (state.revoked) throw new Error('Renderer project-library owner was revoked');
				return value;
			});
		} catch (error) {
			return Promise.reject(error);
		}
		state.operations.add(admitted);
		void admitted.then(
			() => { state.operations.delete(admitted); },
			() => { state.operations.delete(admitted); },
		);
		return admitted;
	}

	assertActive(owner) {
		if (this.#disposed) throw new Error('Renderer project-library operations were disposed');
		const state = this.#state(reference(owner));
		if (state.revoked) throw new Error('Renderer project-library owner was revoked');
	}

	revokeOwner(owner) {
		const state = this.#owners.get(reference(owner));
		if (!state) return Promise.resolve();
		state.revoked = true;
		state.controller.abort(new Error('Renderer project-library owner was revoked'));
		return drain(state.operations);
	}

	dispose() {
		if (!this.#disposed) {
			this.#disposed = true;
			for (const state of this.#states) {
				state.revoked = true;
				state.controller.abort(new Error('Renderer project-library operations were disposed'));
			}
		}
		return Promise.allSettled([...this.#states].map((state) => drain(state.operations))).then(() => undefined);
	}

	#state(owner) {
		let state = this.#owners.get(owner);
		if (!state) {
			state = { controller: new AbortController(), operations: new Set(), revoked: false };
			this.#owners.set(owner, state);
			this.#states.add(state);
		}
		return state;
	}
}

function drain(operations) {
	return Promise.allSettled([...operations]).then(() => undefined);
}

function reference(value) {
	if ((typeof value !== 'object' || value === null) && typeof value !== 'function') {
		throw new TypeError('Renderer project-library owner must be an object reference');
	}
	return value;
}

/* SPDX-License-Identifier: AGPL-3.0-only */

/** Drains every main-owned capability associated with one renderer identity. */
export class DesktopRendererOwnershipCleanup {
	#drains = new WeakMap();
	#revokeNativeTier;
	#linkedVideoLocators;
	#ownership;
	#projectLibraryIpc;
	#readCapabilities;
	#reportError;
	#saves;

	constructor({ linkedVideoLocators, ownership, projectLibraryIpc, readCapabilities, reportError, revokeNativeTier, saves }) {
		this.#revokeNativeTier = revokeNativeTier;
		this.#linkedVideoLocators = linkedVideoLocators;
		this.#ownership = ownership;
		this.#projectLibraryIpc = projectLibraryIpc;
		this.#readCapabilities = readCapabilities;
		this.#reportError = reportError;
		this.#saves = saves;
	}

	revoke(webContents) {
		void this.drain(webContents).catch((error) => this.#reportError(error));
	}

	start(owner) {
		void this.#drainOwner(owner).catch((error) => this.#reportError(error));
	}

	drain(webContents) {
		const pending = this.#drains.get(webContents);
		if (pending) return pending;
		const owner = this.#ownership.revoke(webContents);
		if (!owner) return Promise.resolve(false);
		const operation = this.#drainOwner(owner).then(() => true);
		this.#drains.set(webContents, operation);
		void operation.then(
			() => { if (this.#drains.get(webContents) === operation) this.#drains.delete(webContents); },
			() => { if (this.#drains.get(webContents) === operation) this.#drains.delete(webContents); },
		);
		return operation;
	}

	async #drainOwner(owner) {
		const results = await Promise.allSettled([
			this.#revokeNativeTier?.(owner),
			this.#linkedVideoLocators()?.revokeOwner(owner),
			this.#projectLibraryIpc()?.revokeOwner(owner),
			this.#readCapabilities.revokeOwner(owner),
			this.#saves.revokeOwner(owner),
		]);
		const failures = results.filter(({ status }) => status === 'rejected').map(({ reason }) => reason);
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) throw new AggregateError(failures, 'Desktop renderer ownership cleanup failed');
	}
}

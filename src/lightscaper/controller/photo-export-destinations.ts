/* SPDX-License-Identifier: AGPL-3.0-only */

/** Generation-owned destination joins; unregistering a dialog never discards its cleanup. */
export class PhotoExportDestinations {
	#open = true;
	#owners = new Set<() => Promise<void>>();
	#drains = new Set<Promise<void>>();
	register(cancelAndJoin: () => Promise<void>): () => void {
		if (!this.#open) throw new DOMException('Photo export generation is closed.', 'AbortError');
		this.#owners.add(cancelAndJoin);
		return () => {
			if (!this.#owners.delete(cancelAndJoin)) return;
			this.#start(cancelAndJoin);
		};
	}
	retireAndJoin(): Promise<void> {
		this.#open = false;
		const owners = [...this.#owners]; this.#owners.clear();
		for (const owner of owners) this.#start(owner);
		return join([...this.#drains]);
	}
	#start(owner: () => Promise<void>): void {
		let pending: Promise<void>;
		try { pending = Promise.resolve(owner()); } catch (error) { pending = Promise.reject(error); }
		this.#drains.add(pending);
		void pending.then(() => { this.#drains.delete(pending); }, () => undefined);
	}
}
async function join(pending: readonly Promise<void>[]): Promise<void> {
	const results = await Promise.allSettled(pending);
	const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
	if (failures.length === 1) throw failures[0];
	if (failures.length) throw new AggregateError(failures, 'Photo export destination cleanup failed.');
}

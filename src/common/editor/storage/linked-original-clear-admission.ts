/* SPDX-License-Identifier: AGPL-3.0-only */

export interface LocalStoreClearOperation {
	readonly localCommit: Promise<boolean>;
	readonly completion: Promise<void>;
}

export interface LocalStoreClearAdmission {
	begin(): LocalStoreClearOperation;
	cancel(): void;
}

export interface LocalStoreClearPort {
	admitClear?(): LocalStoreClearAdmission;
	beginClear?(): LocalStoreClearOperation;
	clear(): Promise<void>;
}

export function admitLocalStoreClear(port: LocalStoreClearPort): LocalStoreClearAdmission {
	if (typeof port.admitClear === 'function') return port.admitClear();
	let pending = true;
	return Object.freeze({
		begin(): LocalStoreClearOperation {
			if (!pending) throw new Error('The local store clear admission is no longer current.');
			pending = false;
			return beginLocalStoreClear(port);
		},
		cancel(): void { pending = false; },
	});
}

function beginLocalStoreClear(port: LocalStoreClearPort): LocalStoreClearOperation {
	if (typeof port.beginClear === 'function') return port.beginClear();
	const completion = Promise.resolve().then(() => port.clear());
	return Object.freeze({
		localCommit: completion.then(() => true, () => false),
		completion,
	});
}

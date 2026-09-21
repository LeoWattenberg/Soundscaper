/* SPDX-License-Identifier: AGPL-3.0-only */

export function createBrowserTargetSessionOwnership() {
	const sessionsByTarget = new Map();
	const targetsBySession = new Map();
	return Object.freeze({
		admit(targetId, sessionId) {
			assertIdentifier(targetId, 'target');
			assertIdentifier(sessionId, 'session');
			if (sessionsByTarget.has(targetId)) return false;
			if (targetsBySession.has(sessionId)) {
				throw new Error(`Browser target session ${sessionId} is already admitted.`);
			}
			sessionsByTarget.set(targetId, sessionId);
			targetsBySession.set(sessionId, targetId);
			return true;
		},
		clear() {
			sessionsByTarget.clear();
			targetsBySession.clear();
		},
		release(sessionId) {
			const targetId = targetsBySession.get(sessionId);
			if (targetId === undefined) return false;
			targetsBySession.delete(sessionId);
			sessionsByTarget.delete(targetId);
			return true;
		},
	});
}

export function countTargetTypes(recorders) {
	const counts = new Map();
	for (const { type } of recorders) counts.set(type, (counts.get(type) ?? 0) + 1);
	return new Map([...counts].sort(([left], [right]) => left.localeCompare(right)));
}

function assertIdentifier(value, label) {
	if (typeof value !== 'string' || value === '') {
		throw new TypeError(`Browser ${label} ID must be a non-empty string.`);
	}
}

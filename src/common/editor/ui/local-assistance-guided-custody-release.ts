/* SPDX-License-Identifier: AGPL-3.0-only */

/** Retryable ownership for native Guided jobs whose custody has not acknowledged release. */

export interface LocalAssistanceGuidedCustodyReleaseTracker {
	track(jobId: string): void;
	release(jobId: string): Promise<boolean>;
	releaseLater(jobIds: readonly string[]): void;
	releaseAll(): Promise<boolean>;
	pendingCount(): number;
}

export function createLocalAssistanceGuidedCustodyReleaseTracker(
	releasePort: (jobId: string) => Promise<boolean>,
): Readonly<LocalAssistanceGuidedCustodyReleaseTracker> {
	if (typeof releasePort !== 'function') {
		throw new TypeError('Guided custody release requires one native release port.');
	}
	const pending = new Set<string>();
	const inFlight = new Map<string, Promise<boolean>>();
	const track = (jobId: string): void => { pending.add(identifier(jobId)); };
	const release = (jobIdValue: string): Promise<boolean> => {
		const jobId = identifier(jobIdValue);
		track(jobId);
		const existing = inFlight.get(jobId);
		if (existing) return existing;
		const attempt = runRelease(jobId);
		inFlight.set(jobId, attempt);
		return attempt;
	};
	const runRelease = async (jobId: string): Promise<boolean> => {
		await Promise.resolve();
		try {
			const released = await releasePort(jobId);
			if (released) pending.delete(jobId);
			return released;
		} catch {
			return false;
		} finally {
			inFlight.delete(jobId);
		}
	};
	const releaseMany = async (jobIds: readonly string[]): Promise<boolean> => {
		const results = await Promise.all([...new Set(jobIds)].map(release));
		return results.every(Boolean);
	};
	const releaseLater = (jobIds: readonly string[]): void => {
		for (const jobId of jobIds) track(jobId);
		void releaseMany(jobIds);
	};
	const releaseAll = (): Promise<boolean> => releaseMany([...pending]);
	return Object.freeze({ track, release, releaseLater, releaseAll,
		pendingCount: () => pending.size });
}

function identifier(value: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 256) {
		throw new TypeError('Guided custody release requires one bounded job ID.');
	}
	return value;
}

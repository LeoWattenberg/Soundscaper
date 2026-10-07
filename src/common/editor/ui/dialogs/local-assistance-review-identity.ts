/* SPDX-License-Identifier: AGPL-3.0-only */
import { useMemo } from 'react';
import type { LocalAssistanceSnapshot } from '../local-assistance-session-types.ts';

export function localAssistanceReviewIdentity(snapshot: Pick<LocalAssistanceSnapshot, 'result'>): string | null {
	if (!snapshot.result || snapshot.result.outputs.length === 0) return null;
	return JSON.stringify([snapshot.result.operation, ...snapshot.result.outputs.map(output => [
		output.slotId ?? null, output.claim.claimVersion, output.claim.claimId, output.claim.jobId,
		output.claim.role, output.claim.mediaType, output.claim.byteLength, output.claim.sha256,
	])]);
}

export function useLocalAssistanceReviewIdentity(result: LocalAssistanceSnapshot['result']) {
	return useMemo(() => localAssistanceReviewIdentity({ result }), [result]);
}

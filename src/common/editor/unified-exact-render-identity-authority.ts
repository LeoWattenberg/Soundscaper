/* SPDX-License-Identifier: AGPL-3.0-only */

/** Typed identities admitted by the cumulative V9-V12 exact render graph. */
export type UnifiedExactRenderIdentityKind =
	| 'project'
	| 'sequence'
	| 'track'
	| 'source-node'
	| 'source'
	| 'clip-node'
	| 'clip'
	| 'video-effect'
	| 'transition-node'
	| 'transition'
	| 'visual-node'
	| 'visual-model'
	| 'generator-source'
	| 'professional-media-node'
	| 'openfx-node'
	| 'openfx-instance';

export interface UnifiedExactRenderIdentityClaim {
	readonly identity: string;
	readonly kind: UnifiedExactRenderIdentityKind;
	readonly owner: string;
	readonly role: string | null;
}

export interface UnifiedExactRenderIdentityIndex {
	readonly byId: ReadonlyMap<string, UnifiedExactRenderIdentityClaim>;
}

export function createUnifiedExactRenderIdentityIndex(
	claims: Iterable<UnifiedExactRenderIdentityClaim>,
): UnifiedExactRenderIdentityIndex {
	const byId = new Map<string, UnifiedExactRenderIdentityClaim>();
	for (const claim of claims) {
		const existing = byId.get(claim.identity);
		if (existing !== undefined) {
			throw new RangeError(
				`Unified graph identity ${claim.identity} is ambiguous between ${existing.owner} and ${claim.owner}.`,
			);
		}
		byId.set(claim.identity, Object.freeze({ ...claim }));
	}
	return Object.freeze({ byId });
}

export function requireUnifiedExactRenderIdentity(
	index: UnifiedExactRenderIdentityIndex,
	identity: string,
	allowedKinds: ReadonlySet<UnifiedExactRenderIdentityKind>,
	name: string,
): UnifiedExactRenderIdentityClaim {
	const claim = index.byId.get(identity);
	if (claim === undefined) throw new ReferenceError(`Unified ${name} ${identity} is unresolved.`);
	if (!allowedKinds.has(claim.kind)) {
		throw new ReferenceError(
			`Unified ${name} ${identity} targets identity family ${claim.kind}, which is not allowed.`,
		);
	}
	return claim;
}

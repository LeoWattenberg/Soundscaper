/* SPDX-License-Identifier: AGPL-3.0-only */

type SourceProvenanceDerivationRuntime = typeof import('./source-provenance-derivation.ts');

let runtime: Promise<SourceProvenanceDerivationRuntime> | null = null;

/** Load provenance merging only after an operation has committed to deriving media. */
export function loadSourceProvenanceDerivation(): Promise<SourceProvenanceDerivationRuntime> {
	runtime ??= import('./source-provenance-derivation.ts');
	return runtime;
}

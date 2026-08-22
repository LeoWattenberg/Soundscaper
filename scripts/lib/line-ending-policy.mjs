/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Line-ending policy for digest-pinned text inputs.
 *
 * A tree whose every file is pinned by byte length and SHA-256 only survives a
 * Windows checkout if Git is told to keep it at LF: with the `core.autocrlf=true`
 * that Windows CI agents default to, each pinned text file gains a byte per line
 * and every digest in its manifest stops matching. That failure surfaces far from
 * its cause — a packaging job on one platform reporting hundreds of mismatches for
 * sources nobody edited — so the audits that own those manifests assert the pin
 * here instead, on every platform, next to the digests it protects.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Report a finding for each `.gitattributes` pattern that does not pin LF. Patterns
 * are matched literally against the file's lines, so callers pass the same pattern
 * text the policy is written with.
 */
export function lineEndingPolicyFindings(repositoryRoot, patterns) {
	let attributes;
	try {
		attributes = readFileSync(join(repositoryRoot, '.gitattributes'), 'utf8');
	} catch {
		// A root that states no policy pins nothing, which is the finding rather than a crash.
		return patterns.map((pattern) => `.gitattributes must pin LF for ${pattern}.`);
	}
	const lines = new Set(attributes.split(/\r?\n/u).map((line) => line.trim()));
	return patterns
		.filter((pattern) => !lines.has(`${pattern} text eol=lf`))
		.map((pattern) => `.gitattributes must pin LF for ${pattern}.`);
}

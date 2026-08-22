/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The pinned Boost.Multiprecision 1.92.0 header closure that the exact retime ordinal
 * oracle compiles against is a build-time input this repository pins by digest but does
 * not vendor, so a checkout without it is a supported configuration:
 * `scripts/audit-framescaper-media-host.mjs` reports it as `pin-bound`, and a native host
 * built without it fails closed rather than approximating the arithmetic.
 *
 * Failing closed is total for unified plans. `validate_retime_intent` always demands the
 * exact intent authority, so a Boost-less media host refuses every V9-and-later plan with
 * exit 65 and "requires the pinned exact arithmetic closure" before it reaches any graph,
 * timing or dispatch work. A fixture that builds a native host and then expects a plan to
 * be admitted must therefore consult this probe first. It lives here, shared, because the
 * four copies it replaces drifted: one host builder never grew a probe at all, which is
 * how a supported configuration went red.
 */

import { spawnSync } from 'node:child_process';

export const BOOST_CLOSURE_ABSENT_REASON =
	'The pinned Boost closure is not provisioned on this source-audit host.';

let probed = null;

/** Compiler arguments that put the pinned closure on the include path when provisioned. */
export function boostClosureIncludeArguments() {
	const root = process.env.FRAMESCAPER_BOOST_192_SOURCE_ROOT;
	return root === undefined ? [] : ['-I', root];
}

/** Whether `boost/multiprecision/cpp_int.hpp` resolves for the C++ toolchain in use. */
export function exactRetimeClosureAvailable() {
	probed ??= spawnSync('c++', [
		'-std=c++20', ...boostClosureIncludeArguments(), '-fsyntax-only', '-x', 'c++', '-',
	], { encoding: 'utf8', input: '#include <boost/multiprecision/cpp_int.hpp>\n' }).status === 0;
	return probed;
}

/**
 * Skip `context` unless the closure is provisioned, reporting whether the caller may
 * continue. Fixtures that already probed pass their own result rather than recompiling.
 */
export function requireExactRetimeClosure(context, available = exactRetimeClosureAvailable()) {
	if (available) return true;
	context.skip(BOOST_CLOSURE_ABSENT_REASON);
	return false;
}

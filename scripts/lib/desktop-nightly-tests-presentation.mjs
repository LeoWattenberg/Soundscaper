/* SPDX-License-Identifier: AGPL-3.0-only */

// The nightly-with-tests bundle reports its verdict through a modal dialog,
// which is right for somebody running it at a lab host and fatal anywhere the
// run is unattended: the process waits on a button nobody will press. An
// unattended run prints one machine-readable line instead and exits on it.
const UNATTENDED_FLAG = '--unattended';
const UNATTENDED_VARIABLE = 'SOUNDSCAPER_NIGHTLY_TESTS_UNATTENDED';

export const DESKTOP_NIGHTLY_TESTS_RESULT_MARKER = 'SOUNDSCAPER_NIGHTLY_TESTS_RESULT ';

/** Decide whether the run reports through a dialog or through stdout alone. */
export function resolveDesktopNightlyTestsPresentation({ argv = [], environment = {} } = {}) {
	if (!Array.isArray(argv) || argv.some((value) => typeof value !== 'string')) {
		throw new TypeError('Nightly tests argv must be strings.');
	}
	if (environment === null || typeof environment !== 'object') {
		throw new TypeError('Nightly tests environment must be a record.');
	}
	const requested = argv.includes(UNATTENDED_FLAG)
		|| readOwnString(environment, UNATTENDED_VARIABLE) === '1';
	return Object.freeze({ unattended: requested });
}

/** One parsable line carrying everything an unattended caller needs. */
export function formatDesktopNightlyTestsSummary({
	status,
	exitCode,
	runRoot,
	failure = null,
} = {}) {
	if (typeof status !== 'string' || status.length === 0) {
		throw new TypeError('Nightly tests summary status must be a non-empty string.');
	}
	if (!Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255) {
		throw new TypeError('Nightly tests summary exit code must be a byte.');
	}
	if (runRoot !== null && typeof runRoot !== 'string') {
		throw new TypeError('Nightly tests summary run root must be a string or null.');
	}
	if (failure !== null && typeof failure !== 'string') {
		throw new TypeError('Nightly tests summary failure must be a string or null.');
	}
	return `${DESKTOP_NIGHTLY_TESTS_RESULT_MARKER}${JSON.stringify({
		schemaVersion: 1,
		status,
		exitCode,
		runRoot,
		failure,
	})}`;
}

/** Read the one summary line an unattended run printed, or throw. */
export function parseDesktopNightlyTestsSummary(output) {
	if (typeof output !== 'string') throw new TypeError('Nightly tests output must be a string.');
	const matches = [];
	for (const line of output.split(/\r?\n/u)) {
		const at = line.indexOf(DESKTOP_NIGHTLY_TESTS_RESULT_MARKER);
		if (at < 0) continue;
		matches.push(JSON.parse(line.slice(at + DESKTOP_NIGHTLY_TESTS_RESULT_MARKER.length)));
	}
	if (matches.length !== 1) {
		throw new Error(`Expected exactly one nightly tests summary; received ${String(matches.length)}.`);
	}
	return Object.freeze(matches[0]);
}

function readOwnString(environment, key) {
	const descriptor = Object.getOwnPropertyDescriptor(environment, key);
	if (!descriptor || !Object.hasOwn(descriptor, 'value')) return undefined;
	return typeof descriptor.value === 'string' ? descriptor.value : undefined;
}

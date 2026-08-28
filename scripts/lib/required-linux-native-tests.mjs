/* SPDX-License-Identifier: AGPL-3.0-only */

const REQUIRED_SKIP_REASONS = Object.freeze([
	/\bC\+\+(?:20)? compiler is (?:unavailable|not installed)\b/iu,
	/\bno native addon payload for this host\b/iu,
	/\bpinned Boost closure is not provisioned\b/iu,
	/\bNo (?:complete )?five-target recipe\b/iu,
	/\bcheckout carries no Git metadata\b/iu,
]);

const REQUIRED_BOOLEAN_SKIP_TEST_FILES = new Set([
	'desktop-native-helper-host-job.test.js',
	'desktop-native-helper-scan-job.test.js',
	'native-fixture-plugin-fault-supervision.test.js',
	'native-fixture-plugin-format.test.js',
	'native-helper-addon-argument-contract.test.js',
	'native-helper-alsa-negotiation.test.js',
	'native-helper-pipewire-negotiation.test.js',
	'native-helper-synthetic-verification.test.js',
	'native-pipewire-backend.test.js',
]);

export const REQUIRED_LINUX_NATIVE_SKIP_REPORT_ENV =
	'SOUNDSCAPER_REQUIRED_LINUX_NATIVE_SKIP_REPORT';

function basename(path) {
	return path.replaceAll('\\', '/').split('/').at(-1);
}

/** Whether one successful Node test event actually records a missing native prerequisite. */
export function requiresLinuxNativeTestExecution(skip, file) {
	if (skip === true) {
		return typeof file === 'string' && REQUIRED_BOOLEAN_SKIP_TEST_FILES.has(basename(file));
	}
	return typeof skip === 'string' && REQUIRED_SKIP_REASONS.some((pattern) => pattern.test(skip));
}

export function requiredLinuxNativeSkipError(report) {
	const detail = report.trim();
	return detail.length === 0 ? null : new Error(`Required Linux native tests skipped:\n${detail}`);
}

export function requiredLinuxNativeSkipDetail(event) {
	if (event?.type !== 'test:pass'
		|| !requiresLinuxNativeTestExecution(event.data?.skip, event.data?.file)) {
		return null;
	}
	const location = event.data?.file === undefined
		? '<unknown test file>'
		: `${event.data.file}${event.data.line === undefined ? '' : `:${String(event.data.line)}`}`;
	const reason = event.data.skip === true ? 'implicit prerequisite skip' : event.data.skip;
	return `${location}: ${String(event.data?.name ?? '<unnamed test>')} — ${reason}`;
}

/** Keep the CI promise target-specific instead of making other hosts fail for supported omissions. */
export function assertRequiredLinuxNativeTestHost(platform, architecture) {
	if (platform !== 'linux' || architecture !== 'x64') {
		throw new Error(`Required Linux native tests require linux-x64; received ${platform}-${architecture}.`);
	}
}

/**
 * Pass every event to the ordinary reporter, then make any required native skip
 * fail the test process. Node otherwise records skips as successful tests.
 */
export async function* requireLinuxNativeTestEvents(source, options = {}) {
	const skipped = [];
	for await (const event of source) {
		const detail = requiredLinuxNativeSkipDetail(event);
		if (detail !== null) {
			skipped.push(detail);
			options.onRequiredSkip?.(detail);
		}
		yield event;
	}
	if (skipped.length > 0) {
		throw requiredLinuxNativeSkipError(skipped.join('\n'));
	}
}

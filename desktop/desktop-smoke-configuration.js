/* SPDX-License-Identifier: AGPL-3.0-only */

import { DESKTOP_DIRECT_WAV_SMOKE_MODE, decodeDirectWavSmokePlan } from './direct-wav-smoke.js';
import {
	DESKTOP_PROJECT_LIBRARY_LEASE_SMOKE_MODE,
	decodeDesktopProjectLibraryLeaseSmokePlan,
} from './project-library-lease-smoke.js';
import {
	DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_MODE,
	decodeDesktopProjectLibrarySourceBearingPlan,
} from './project-library-source-bearing-smoke.js';
import { DESKTOP_SCAPE_OPEN_SMOKE_MODE, decodeScapeOpenSmokePlan } from './scape-open-smoke.js';
import { DESKTOP_SCAPE_REOPEN_SMOKE_MODE, decodeScapeReopenSmokePlan } from './scape-reopen-smoke.js';
import {
	DESKTOP_VIDEO_TIMING_PROBE_MODE,
	decodeDesktopVideoTimingProbePlan,
} from './video-timing-probe-smoke.js';

const SMOKE_ARGUMENT = '--soundscaper-smoke';
const SMOKE_MODE_PREFIX = '--soundscaper-smoke-mode=';
const SMOKE_PLAN_PREFIX = '--soundscaper-smoke-plan=';
const PROJECT_LIBRARY_MODE = 'project-library-handoff-v1';

export function parseDesktopSmokeConfigurationWithProjectPlan(argv, decodeProjectPlan) {
	if (!Array.isArray(argv) || argv.some((argument) => typeof argument !== 'string')) {
		throw new TypeError('Desktop smoke arguments must be strings');
	}
	if (typeof decodeProjectPlan !== 'function') throw new TypeError('Desktop smoke project-plan decoder is required');
	const smokeCount = argv.filter((argument) => argument === SMOKE_ARGUMENT).length;
	const modes = valuesForPrefix(argv, SMOKE_MODE_PREFIX);
	const plans = valuesForPrefix(argv, SMOKE_PLAN_PREFIX);
	if (smokeCount === 0) {
		if (modes.length || plans.length) throw new TypeError('Desktop smoke mode and plan require smoke mode');
		return Object.freeze({ mode: 'disabled', plan: null });
	}
	if (smokeCount !== 1) throw new TypeError('Desktop smoke requires exactly one smoke argument');
	if (modes.length === 0 && plans.length === 0) return Object.freeze({ mode: 'artifact', plan: null });
	if (modes.length === 0 && plans.length > 0) {
		throw new TypeError('Desktop smoke plan requires project-library, direct-WAV, Scape-open, persisted-reopen, or video timing-probe smoke mode');
	}
	if (modes.length !== 1) throw new TypeError('Desktop smoke requires exactly one smoke mode');
	if (plans.length !== 1) throw new TypeError(`${labelFor(modes[0])} smoke mode requires exactly one smoke plan`);
	const decoders = new Map([
		[PROJECT_LIBRARY_MODE, decodeProjectPlan],
		[DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_MODE, decodeDesktopProjectLibrarySourceBearingPlan],
		[DESKTOP_PROJECT_LIBRARY_LEASE_SMOKE_MODE, decodeDesktopProjectLibraryLeaseSmokePlan],
		[DESKTOP_DIRECT_WAV_SMOKE_MODE, decodeDirectWavSmokePlan],
		[DESKTOP_SCAPE_OPEN_SMOKE_MODE, decodeScapeOpenSmokePlan],
		[DESKTOP_SCAPE_REOPEN_SMOKE_MODE, decodeScapeReopenSmokePlan],
		[DESKTOP_VIDEO_TIMING_PROBE_MODE, decodeDesktopVideoTimingProbePlan],
	]);
	const decode = decoders.get(modes[0]);
	if (!decode) throw new TypeError('Unsupported desktop smoke mode');
	return deepFreeze({ mode: modes[0], plan: decode(plans[0]) });
}

function labelFor(mode) {
	if (mode === PROJECT_LIBRARY_MODE) return 'Project-library';
	if (mode === DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_MODE) return 'Source-bearing project-library';
	if (mode === DESKTOP_PROJECT_LIBRARY_LEASE_SMOKE_MODE) return 'Lease-matrix';
	if (mode === DESKTOP_DIRECT_WAV_SMOKE_MODE) return 'Direct-WAV';
	if (mode === DESKTOP_SCAPE_OPEN_SMOKE_MODE) return 'Scape-open';
	if (mode === DESKTOP_SCAPE_REOPEN_SMOKE_MODE) return 'Scape persisted-reopen';
	if (mode === DESKTOP_VIDEO_TIMING_PROBE_MODE) return 'Video timing-probe';
	return 'Unsupported desktop';
}

function valuesForPrefix(argv, prefix) {
	return argv.filter((argument) => argument.startsWith(prefix)).map((argument) => argument.slice(prefix.length));
}

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const item of Object.values(value)) deepFreeze(item);
	return Object.freeze(value);
}

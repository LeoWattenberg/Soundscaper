/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { createDesktopNightlyTestsDualOriginPlan } from '../../scripts/lib/desktop-nightly-tests-dual-origin.mjs';
import type { DesktopNightlyTestsDependencies } from '../../scripts/lib/desktop-nightly-tests-runtime.mjs';

export const runDualOriginPhaseFixture: NonNullable<
	DesktopNightlyTestsDependencies['runDualOriginPhase']
> = async (options, { runPlaywright }) => {
	const origins = JSON.parse(options.environment?.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS ?? 'null') as unknown;
	await mkdir(join(options.runRoot, 'e2e-coverage/dual-origin'), { recursive: true });
	const child = await runPlaywright(createDesktopNightlyTestsDualOriginPlan({
		...options,
		origins: origins as { soundscaper: string; framescaper: string },
	}));
	return Object.freeze({
		child,
		diagnostics: Object.freeze({ passed: child.code === 0 && child.signal == null }),
	});
};

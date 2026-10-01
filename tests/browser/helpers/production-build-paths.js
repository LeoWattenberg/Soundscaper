/* SPDX-License-Identifier: AGPL-3.0-only */

import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BROWSER_PRODUCT_FIXTURE_ROOT } from '../../../scripts/lib/browser-product-site-plan.mjs';

const NIGHTLY_PAYLOAD_ROOT = 'SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT';

/** Locate the verified Soundscaper assets in local and staged nightly layouts. */
export function resolveSoundscaperProductionAssetsDirectory(environment = process.env) {
	return resolveSoundscaperAssetsDirectory(
		resolve(fileURLToPath(new URL('../../../dist/assets/', import.meta.url))),
		environment,
	);
}

/** Locate the assets served by the ordinary or packaged browser-test site. */
export function resolveSoundscaperBrowserAssetsDirectory(environment = process.env) {
	return resolveSoundscaperAssetsDirectory(
		resolve(fileURLToPath(new URL(`../../../${BROWSER_PRODUCT_FIXTURE_ROOT}/soundscaper/assets/`, import.meta.url))),
		environment,
	);
}

function resolveSoundscaperAssetsDirectory(localDirectory, environment) {
	const payloadRoot = environment[NIGHTLY_PAYLOAD_ROOT];
	if (payloadRoot === undefined) {
		return localDirectory;
	}
	if (typeof payloadRoot !== 'string' || !isAbsolute(payloadRoot)) {
		throw new TypeError(`${NIGHTLY_PAYLOAD_ROOT} must be an absolute path.`);
	}
	return join(payloadRoot, 'sites', 'soundscaper', 'assets');
}

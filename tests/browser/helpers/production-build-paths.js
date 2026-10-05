/* SPDX-License-Identifier: AGPL-3.0-only */

import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BROWSER_PRODUCT_FIXTURE_ROOT } from '../../../scripts/lib/browser-product-site-plan.mjs';

const NIGHTLY_PAYLOAD_ROOT = 'SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT';
const BROWSER_FIXTURE_ROOT = 'SCAPE_BROWSER_PRODUCT_FIXTURE_ROOT';

/** Locate the verified Soundscaper assets in local and staged nightly layouts. */
export function resolveSoundscaperProductionAssetsDirectory(environment = process.env) {
	return resolveSoundscaperAssetsDirectory(
		resolve(fileURLToPath(new URL('../../../dist/assets/', import.meta.url))),
		environment,
	);
}

/** Locate the assets served by the ordinary or packaged browser-test site. */
export function resolveSoundscaperBrowserAssetsDirectory(environment = process.env) {
	const configuredRoot = environment[BROWSER_FIXTURE_ROOT];
	if (configuredRoot !== undefined && (typeof configuredRoot !== 'string' || !isAbsolute(configuredRoot))) {
		throw new TypeError(`${BROWSER_FIXTURE_ROOT} must be an absolute path.`);
	}
	const fixtureRoot = configuredRoot
		?? fileURLToPath(new URL(`../../../${BROWSER_PRODUCT_FIXTURE_ROOT}/`, import.meta.url));
	return resolveSoundscaperAssetsDirectory(
		join(fixtureRoot, 'soundscaper', 'assets'),
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

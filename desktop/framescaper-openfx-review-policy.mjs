// @ts-check
/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-owned OpenFX readiness trust, intentionally separate from package signing. */

import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute, join, normalize } from 'node:path';

import {
	MILESTONE_5_NATIVE_ISOLATION_REVIEW_POLICY_PATH,
	resolveNativeIsolationReviewPublicKey,
} from './native-isolation-review-policy.mjs';

const USAGE = 'framescaper-openfx-production-readiness';
const POLICY_NAME = 'milestone-5-native-isolation-review-policy.json';
/** @type {Readonly<Record<string, string>>} */
const TARGETS = Object.freeze({
	'linux-x64': 'linux-x64',
	'linux-arm64': 'linux-arm64',
	'darwin-arm64': 'mac-arm64',
	'win32-x64': 'win-x64',
	'win32-arm64': 'win-arm64',
});

/**
 * @typedef {Readonly<{
 *   applicationRoot: string,
 *   packaged: boolean,
 *   resourcesPath: string,
 *   platform: string,
 *   arch: string,
 * }>} FramescaperOpenFxReviewOptions
 */

/** @param {FramescaperOpenFxReviewOptions} options */
export function createFramescaperOpenFxReviewPayloadPorts(options) {
	if (!options || typeof options !== 'object' || Array.isArray(options)
		|| Reflect.ownKeys(options).length !== 5
		|| ['applicationRoot', 'packaged', 'resourcesPath', 'platform', 'arch']
			.some((field) => !Object.hasOwn(options, field))
		|| typeof options.applicationRoot !== 'string'
		|| !isAbsolute(options.applicationRoot)
		|| normalize(options.applicationRoot) !== options.applicationRoot
		|| typeof options.packaged !== 'boolean'
		|| typeof options.resourcesPath !== 'string' || !isAbsolute(options.resourcesPath)
		|| normalize(options.resourcesPath) !== options.resourcesPath
		|| typeof options.platform !== 'string' || typeof options.arch !== 'string') {
		throw new TypeError('OpenFX review trust requires one exact package location.');
	}
	const target = TARGETS[`${options.platform}-${options.arch}`];
	const policyPath = options.packaged && target
		? join(options.resourcesPath, 'runtime', 'native', 'framescaper-openfx-host', target, POLICY_NAME)
		: join(options.applicationRoot, MILESTONE_5_NATIVE_ISOLATION_REVIEW_POLICY_PATH);
	return Object.freeze({
		readFile,
		// lstat, not stat: verifyPayload refuses symlinked payloads, and a
		// following stat can never report one.
		stat: lstat,
		/**
		 * @param {string} target
		 * @param {string} keyId
		 */
		async resolveReviewPublicKey(target, keyId) {
			let policy;
			try { policy = JSON.parse(String(await readFile(policyPath))); }
			catch (error) {
				throw new TypeError('The native-isolation review policy is unreadable.', { cause: error });
			}
			return resolveNativeIsolationReviewPublicKey(policy, {
				usage: USAGE, target, keyId,
			});
		},
	});
}

/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-owned media-host readiness trust, separate from package-signing and OpenFX keys. */

import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, normalize } from 'node:path';

import {
	MILESTONE_5_NATIVE_ISOLATION_REVIEW_POLICY_PATH,
	resolveNativeIsolationReviewPublicKey,
} from './native-isolation-review-policy.mjs';

const USAGE = 'framescaper-media-host-production-readiness';
const POLICY_NAME = 'milestone-5-native-isolation-review-policy.json';
const TARGETS = Object.freeze({
	'linux-x64': 'linux-x64',
	'linux-arm64': 'linux-arm64',
	'darwin-arm64': 'mac-arm64',
	'win32-x64': 'win-x64',
	'win32-arm64': 'win-arm64',
});

export function createFramescaperMediaReviewPayloadPorts(options) {
	if (!options || typeof options !== 'object' || Array.isArray(options)
		|| Reflect.ownKeys(options).length !== 5
		|| ['applicationRoot', 'packaged', 'resourcesPath', 'platform', 'arch']
			.some((field) => !Object.hasOwn(options, field))
		|| typeof options.applicationRoot !== 'string'
		|| !isAbsolute(options.applicationRoot) || normalize(options.applicationRoot) !== options.applicationRoot
		|| typeof options.packaged !== 'boolean'
		|| typeof options.resourcesPath !== 'string' || !isAbsolute(options.resourcesPath)
		|| normalize(options.resourcesPath) !== options.resourcesPath
		|| typeof options.platform !== 'string' || typeof options.arch !== 'string') {
		throw new TypeError('Media-host review trust requires one exact package location.');
	}
	const target = TARGETS[`${options.platform}-${options.arch}`];
	const policyPath = options.packaged && target
		? join(options.resourcesPath, 'runtime', 'native', 'framescaper-media-host', target, POLICY_NAME)
		: join(options.applicationRoot, MILESTONE_5_NATIVE_ISOLATION_REVIEW_POLICY_PATH);
	return Object.freeze({
		readFile,
		stat,
		async resolveReviewPublicKey(target, keyId) {
			let policy;
			try { policy = JSON.parse(String(await readFile(policyPath))); }
			catch (error) {
				throw new TypeError('The media-host native-isolation review policy is unreadable.', { cause: error });
			}
			return resolveNativeIsolationReviewPublicKey(policy, { usage: USAGE, target, keyId });
		},
	});
}

/* SPDX-License-Identifier: AGPL-3.0-only */

/** Keep route-generator children on the same mapped TS loader as the Node suite. */
export function staticRouteGeneratorArguments(outputRoot: string): string[] {
	return ['--import', 'tsx', 'scripts/generate-static-routes.mjs', outputRoot];
}

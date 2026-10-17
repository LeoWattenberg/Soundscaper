/* SPDX-License-Identifier: AGPL-3.0-only */
import { lstat, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { resolvePagesDeploymentPlan, runPagesCommand, type PagesDeploymentCommand } from './pages-deployment-plan.ts';
import { verifyMotionRelease, type MotionReleaseChannel, type MotionReleaseIdentity } from './motionscaper-release-policy.ts';
import { captureMotionReleaseWebArtifact, verifyMotionReleaseWebArtifact } from './motionscaper-release-web-artifact.ts';

interface Options {
	readonly root: string; readonly tag: string; readonly expectedChannel: MotionReleaseChannel; readonly sourceRevision: string;
	readonly directory: string; readonly evidence: string;
}
function assertCurrent(options: Options, identity: MotionReleaseIdentity): void {
	if (JSON.stringify(verifyMotionRelease(options)) !== JSON.stringify(identity)) throw new Error('Motion production build source changed.');
}
/** The only capture entry point executes the maintained build; existing output is never admitted as a new build. */
export async function buildMotionReleaseWebArtifact(options: Options & {
	readonly environment: NodeJS.ProcessEnv; readonly run?: (command: PagesDeploymentCommand) => Promise<void>;
}) {
	const identity = verifyMotionRelease(options);
	const plan = resolvePagesDeploymentPlan({ product: 'motionscaper', environment: options.environment });
	if (plan.origin !== 'https://motionscaper.org') throw new Error('Motion stable production artifact requires its canonical production origin.');
	if (resolve(options.directory) !== join(resolve(options.root), 'dist')) throw new Error('Motion production build must own the checkout dist directory.');
	if (options.environment.SCAPE_DESKTOP_CODEC_RUNTIME) throw new Error('Motion production build cannot select a desktop runtime.');
	const existing = await lstat(options.directory).catch((error: unknown) => {
		if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null;
		throw error;
	});
	if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) throw new Error('Motion production build output must be an owned regular directory.');
	await rm(options.directory, { recursive: true, force: true });
	const environment = { ...options.environment, SCAPE_PRODUCT: 'motionscaper', MOTIONSCAPER_SITE: plan.origin, SCAPE_BUILD_SOURCE_MAPS: '0' };
	await (options.run ?? runPagesCommand)({ root: options.root, environment, args: ['run', 'build:pages'] });
	assertCurrent(options, identity);
	const artifact = await captureMotionReleaseWebArtifact({ ...options, identity });
	try {
		await verifyMotionReleaseWebArtifact({ ...options, identity });
		assertCurrent(options, identity);
		return artifact;
	} catch (error) {
		// The receipt was created exclusively by this attempt; failed source/byte verification cannot leave an admitted record.
		await rm(options.evidence);
		throw error;
	}
}
export async function verifyMotionReleaseWebBuild(options: Options) {
	const identity = verifyMotionRelease(options);
	const artifact = await verifyMotionReleaseWebArtifact({ ...options, identity });
	assertCurrent(options, identity);
	return artifact;
}

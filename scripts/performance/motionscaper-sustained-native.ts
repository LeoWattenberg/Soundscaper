/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import type { launchMotionSustainedApplication } from './motionscaper-sustained-launch.ts';
import { waitMotionSustainedGone } from './motionscaper-sustained-launch.ts';
import { startMotionSustainedSampler } from './motionscaper-sustained-sampler.ts';
import { finishMotionSustainedRender, motionSustainedRenderProgress, openMotionSustainedRender, removeMotionSustainedJob } from './motionscaper-sustained-ui.ts';
import { assertMotionSustainedNativeClean } from './motionscaper-sustained-cancel.ts';
import { MOTION_SUSTAINED_PLAN as plan } from './motionscaper-sustained-plan.ts';
import { motionSustainedCommand } from './motionscaper-sustained-command.ts';

type Application = Awaited<ReturnType<typeof launchMotionSustainedApplication>>;
export function motionSustainedNativeChooser(root: string, directory: string) {
	let sequence = 0;
	return async (path: string) => {
		const result = await motionSustainedCommand({ command: 'python3', args: ['-B', '-E', '-s', join(root, 'scripts/lib/motionscaper-scene-chooser-x11.py'), '--sustained', path],
			cwd: root, directory, id: `gtk-chooser-${++sequence}`, timeoutMs: 20000 });
		assert.match(result.stdout, /MOTIONSCAPER_NATIVE_FILE_CHOOSER_SELECTED/u);
	};
}
export async function renderMotionSustainedNative(application: Application, options: Readonly<{
	frames: 300 | 1200; directory: string; revisionDigest: string; helperPath: string; choose(path: string): Promise<void>;
}>) {
	const dialog = await openMotionSustainedRender(application.page, 'prores', options.frames);
	const observations: { monotonicMs: number; helpers: Awaited<ReturnType<Application['nativeHelpers']>> }[] = [];
	const sampler = await startMotionSustainedSampler({ phase: 'prores', owner: application.owner, cdp: application.cdp,
		retainProcesses: values => application.retainProcessIdentities(values),
		logPath: join(options.directory, 'prores-memory.jsonl'), progress: async () => {
			const helpers = await application.nativeHelpers();
			for (const helper of helpers) {
				assert.equal(helper.command.split('\0')[0], options.helperPath);
				assert.ok(helper.rssBytes <= plan.maximumNativeHelperRssBytes && helper.pssBytes <= plan.maximumNativeHelperPssBytes, 'Actual encoder memory ceiling exceeded.');
			}
			assert.ok(helpers.length <= 1); if (helpers.length) observations.push({ monotonicMs: performance.now(), helpers });
			return motionSustainedRenderProgress(dialog, options.frames);
		} });
	let stopped = false;
	try {
		const path = join(options.directory, 'output.mov');
		await dialog.getByRole('button', { name: 'Render', exact: true }).click(); await options.choose(path);
		await Promise.race([expect(dialog.getByRole('status')).toHaveText('Render complete', { timeout: plan.maximumPhaseMs }), sampler.failed]);
		const measured = await sampler.stop(); stopped = true;
		assert.ok(observations.length >= 3, 'Encoder phase lacks three real PID/start-bound observations.');
		const first = observations[0]!.helpers[0]!.identity;
		for (const observation of observations) assert.deepEqual(observation.helpers[0]!.identity, first);
		await waitMotionSustainedGone([first]); await assertMotionSustainedNativeClean(options.directory);
		await finishMotionSustainedRender(dialog); await removeMotionSustainedJob(application.page, options.revisionDigest);
		return { path, measured, encoder: observations };
	} finally { if (!stopped) await sampler.stop(); }
}

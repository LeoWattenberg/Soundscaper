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
import { startMotionSustainedEncoderSampler } from './motionscaper-sustained-encoder-sampler.ts';
import { hashMotionSustainedFile } from './motionscaper-sustained-observation.ts';

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
	const sampler = await startMotionSustainedSampler({ phase: 'prores', owner: application.owner, cdp: application.cdp,
		retainProcesses: values => application.retainProcessIdentities(values),
		logPath: join(options.directory, 'prores-memory.jsonl'), progress: () => motionSustainedRenderProgress(dialog, options.frames) });
	let encoder: Awaited<ReturnType<typeof startMotionSustainedEncoderSampler>> | undefined;
	let stopped = false;
	const render = async () => {
		encoder = await startMotionSustainedEncoderSampler({ owner: application.owner, helperPath: options.helperPath,
			retainProcesses: values => application.retainProcessIdentities(values), logPath: join(options.directory, 'encoder-memory.jsonl') });
		const path = join(options.directory, 'output.mov');
		await dialog.getByRole('button', { name: 'Render', exact: true }).click(); await options.choose(path);
		await Promise.race([expect(dialog.getByRole('status')).toHaveText('Render complete', { timeout: plan.maximumPhaseMs }), sampler.failed, encoder.failed]);
		const encoderMeasured = await encoder.stop(), observations = encoderMeasured.observations;
		const measured = await sampler.stop(); stopped = true;
		const first = observations[0]!.helpers[0]!.identity;
		await waitMotionSustainedGone([first]); await assertMotionSustainedNativeClean(options.directory);
		await finishMotionSustainedRender(dialog); await removeMotionSustainedJob(application.page, options.revisionDigest);
		return { path, measured, encoder: observations, encoderObservation: { attemptedPeriodMs: encoderMeasured.attemptedPeriodMs,
			attempts: encoderMeasured.attempts, log: await hashMotionSustainedFile(encoderMeasured.logPath) } };
	};
	const errors: unknown[] = []; let result: Awaited<ReturnType<typeof render>> | undefined;
	try { result = await render(); } catch (error) { errors.push(error); }
	const cleanup = await Promise.allSettled([...(encoder ? [encoder.stop()] : []), ...(!stopped ? [sampler.stop()] : [])]);
	for (const closed of cleanup) if (closed.status === 'rejected' && !errors.includes(closed.reason)) errors.push(closed.reason);
	if (errors.length || !result) throw new AggregateError(errors, 'Native render or sampler cleanup failed.');
	return result;
}

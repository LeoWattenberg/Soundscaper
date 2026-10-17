/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { qualifyMotionscaperSustainedWorkload } from './helpers/motionscaper-sustained-workload.ts';

test('Motion sustained worker, PCM decode and PNG delivery bound their queues in the controlled Node profile', async t => {
	// This declared Node CPU profile controls V8 policy in both the delivery process and its real preview worker.
	// It qualifies these durations, not browser RSS or the product's maximum geometry/duration.
	const moduleUrl = new URL('./helpers/motionscaper-sustained-workload.ts', import.meta.url).href;
	const { stdout } = await promisify(execFile)(process.execPath, ['--max-old-space-size=128', '--import', 'tsx', '-e',
		`import(${JSON.stringify(moduleUrl)}).then(async ({ qualifyMotionscaperSustainedWorkload }) => { console.log(JSON.stringify(await qualifyMotionscaperSustainedWorkload([80, 320]))); }).catch(error => { console.error(error); process.exitCode = 1; });`], { timeout: 180000, maxBuffer: 1024 * 1024 });
	const report = JSON.parse(stdout) as Awaited<ReturnType<typeof qualifyMotionscaperSustainedWorkload>>;
	t.diagnostic(JSON.stringify(report));
	assert.ok(report.heapSizeLimitBytes <= 256 * 1024 * 1024);
	assert.equal(report.runs.length, 2);
	for (const run of report.runs) {
		assert.equal(run.previewFrames, run.frames); assert.equal(run.renderedFrames, run.frames);
		assert.equal(run.audioSamples, run.frames * 1600); assert.equal(run.sourceLoads, 1);
		assert.equal(run.maximumDestinationFlights, 1); assert.equal(run.closed, true);
		assert.ok(run.maximumPreviewCacheBytes <= 1024 * 1024);
		assert.ok(run.maximumPcmCacheBytes <= 32768);
		assert.equal(run.maximumFontProviders, 1); assert.ok(run.maximumFontBytes <= 64 * 1024 * 1024);
		assert.ok(run.outputBytes > run.frames * 512);
		assert.match(run.tarSha256, /^[a-f\d]{64}$/u); assert.match(run.pcmSha256, /^[a-f\d]{64}$/u);
	}
	assert.ok(report.maximumRssBytes <= 512 * 1024 * 1024, JSON.stringify(report));
});

test('Motion sustained qualification refuses counts beyond retained WAV admission before allocating media', async () => {
	for (const counts of [[], [0], [10486], [1, 1, 1, 1, 1]]) await assert.rejects(qualifyMotionscaperSustainedWorkload(counts), /64 MiB retained WAV admission/u);
});

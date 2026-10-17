/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { resolvePagesDeploymentPlan, deployProductPages, runPagesCommand } from '../scripts/lib/pages-deployment-plan.ts';

test('Motion deployment selects its own Pages identity and preserves Sound default and Frame selection', () => {
	assert.equal(resolvePagesDeploymentPlan({ environment: {} }).projectName, 'soundscaper');
	assert.equal(resolvePagesDeploymentPlan({ environment: { SCAPE_PRODUCT: '' } }).projectName, 'soundscaper');
	assert.equal(resolvePagesDeploymentPlan({ product: '', environment: {} }).projectName, 'soundscaper');
	assert.equal(resolvePagesDeploymentPlan({ product: 'motionscaper', environment: { SCAPE_PRODUCT: '' } }).productId, 'motionscaper');
	assert.equal(resolvePagesDeploymentPlan({ environment: { SCAPE_PRODUCT: 'motionscaper', MOTIONSCAPER_SITE: 'https://motion.example.org/', SCAPE_DEPLOY_AUDIT_ORIGIN: 'https://motion.example.org' } }).origin, 'https://motion.example.org');
	for (const productId of ['soundscaper', 'framescaper', 'motionscaper']) {
		assert.deepEqual(resolvePagesDeploymentPlan({ environment: { SCAPE_PRODUCT: productId } }), {
			productId, projectName: productId, origin: `https://${productId}.org`,
		});
	}
	for (const options of [
		{ product: 'motionscaper', project: 'soundscaper', environment: {} },
		{ product: 'motionscaper', environment: { SCAPE_PRODUCT: 'framescaper' } },
		{ environment: { SCAPE_PRODUCT: 'unknown' } },
		{ environment: { SCAPE_PRODUCT: 'motionscaper', MOTIONSCAPER_SITE: 'http://127.0.0.1:4346' } },
		{ environment: { SCAPE_PRODUCT: 'motionscaper', MOTIONSCAPER_SITE: 'https://soundscaper.org' } },
		{ environment: { SCAPE_PRODUCT: 'motionscaper', MOTIONSCAPER_SITE: 'https://frame.example.org', FRAMESCAPER_SITE: 'https://frame.example.org' } },
		{ environment: { SCAPE_PRODUCT: 'motionscaper', MOTIONSCAPER_SITE: 'https://user:password@motion.example.org' } },
		{ environment: { SCAPE_PRODUCT: 'motionscaper', MOTIONSCAPER_SITE: 'https://motion.example.org', SCAPE_DEPLOY_AUDIT_ORIGIN: 'https://motionscaper.org' } },
		{ environment: { SCAPE_PRODUCT: 'motionscaper', SCAPE_DEPLOY_AUDIT_ORIGIN: 'https://soundscaper.org' } },
		{ environment: { SCAPE_PRODUCT: 'framescaper', SCAPE_FRAMESCAPER_LINE: 'successor' } },
	]) assert.throws(() => resolvePagesDeploymentPlan(options), /product|project|origin|successor/u);
});

test('Motion Pages command invokes the installed npm JavaScript through Node without a shell or npm.cmd', async () => {
	const root = await mkdtemp(join(tmpdir(), 'motionscaper npm entry '));
	try {
		const directory = join(root, 'node_modules/npm'); const entry = join(directory, 'bin/npm-cli.js');
		await mkdir(join(directory, 'bin'), { recursive: true });
		await writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'npm', version: '12.0.1', bin: { npm: 'bin/npm-cli.js' } }));
		await writeFile(entry, 'require("node:fs").writeFileSync("observed.json", JSON.stringify(process.argv.slice(2)));');
		await runPagesCommand({ root, environment: { ...process.env, npm_execpath: entry }, args: ['run', 'test fixture & literal'] });
		assert.deepEqual(JSON.parse(await readFile(join(root, 'observed.json'), 'utf8')), ['run', 'test fixture & literal']);
		await assert.rejects(runPagesCommand({ root, environment: { ...process.env, npm_execpath: join(root, 'npm.cmd') }, args: [] }));
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('Motion deploy refuses a conflicting selection before invoking any external command', async () => {
	let calls = 0;
	await assert.rejects(deployProductPages({ root: '/missing', product: 'motionscaper', project: 'soundscaper', environment: {}, run: async () => { calls++; } }), /project/u);
	assert.equal(calls, 0);
});

test('Motion deploy verifies the emitted product before upload and binds post-deploy checking to the exact local shell', async () => {
	const root = await mkdtemp(join(tmpdir(), 'motionscaper-deploy-'));
	const calls: { args: readonly string[]; environment: NodeJS.ProcessEnv }[] = [];
	try {
		const run = async (request: { args: readonly string[]; environment: NodeJS.ProcessEnv }) => {
			calls.push(request);
			if (calls.length !== 1) return;
			await mkdir(join(root, 'dist/en'), { recursive: true });
			await writeFile(join(root, 'dist/en/index.html'), '<html data-product="motionscaper"><link rel="canonical" href="https://motionscaper.org/en/"></html>');
			await writeFile(join(root, 'dist/manifest-motionscaper.webmanifest'), '{}');
			await writeFile(join(root, 'dist/offline-shell.json'), JSON.stringify({ schemaVersion: 2, workers: { motionscaper: { scope: '/', scriptUrl: '/service-worker.js' } } }));
		};
		await deployProductPages({ root, product: 'motionscaper', environment: {}, run });
		assert.equal(calls.length, 3);
		assert.deepEqual(calls[0]!.args, ['run', 'build:pages']);
		assert.deepEqual(calls[1]!.args, ['exec', '--', 'wrangler', 'pages', 'deploy', 'dist', '--project-name=motionscaper']);
		assert.deepEqual(calls[2]!.args, ['run', 'verify:pages']);
		assert.equal(calls[2]!.environment.SCAPE_DEPLOY_EXPECTED_OFFLINE_SHELL, join(root, 'dist/offline-shell.json'));
		assert.equal(calls[2]!.environment.SCAPE_DEPLOY_AUDIT_ORIGIN, 'https://motionscaper.org');
		assert.ok(calls.every(call => call.environment.SCAPE_PRODUCT === 'motionscaper'));
		calls.length = 0;
		await assert.rejects(deployProductPages({ root, product: 'framescaper', environment: {}, run: async request => { calls.push(request); } }), /product/u);
		assert.equal(calls.length, 1, 'wrong emitted site never reaches wrangler');
		calls.length = 0;
		await deployProductPages({ root, product: 'motionscaper', environment: { MOTIONSCAPER_SITE: 'https://motion.example.org' }, run: async request => {
			calls.push(request);
			if (calls.length === 1) await writeFile(join(root, 'dist/en/index.html'), '<html data-product="motionscaper"><link rel="canonical" href="https://motion.example.org/en/"></html>');
		} });
		assert.equal(calls.length, 3); assert.equal(calls[2]!.environment.SCAPE_DEPLOY_AUDIT_ORIGIN, 'https://motion.example.org');
	} finally { await rm(root, { recursive: true, force: true }); }
});

/* SPDX-License-Identifier: AGPL-3.0-only */
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { webBuildRouting } from './product-web-routing.mjs';
import { runPagesCommand } from './pages-npm-command.ts';
export { runPagesCommand } from './pages-npm-command.ts';

const PRODUCTS = ['soundscaper', 'framescaper', 'motionscaper'] as const;
type Product = typeof PRODUCTS[number];
export interface PagesDeploymentPlan { readonly productId: Product; readonly projectName: Product; readonly origin: string }
interface Selection { readonly product?: string; readonly project?: string; readonly environment: NodeJS.ProcessEnv }
export interface PagesDeploymentCommand { readonly root: string; readonly args: readonly string[]; readonly environment: NodeJS.ProcessEnv }

export function resolvePagesDeploymentPlan({ product, project, environment }: Selection): PagesDeploymentPlan {
	const selected = (product ?? environment.SCAPE_PRODUCT) || 'soundscaper';
	const productId = PRODUCTS.find(value => value === selected);
	if (!productId || (product !== undefined && environment.SCAPE_PRODUCT && selected !== environment.SCAPE_PRODUCT)) throw new Error('Pages deployment product selection conflicts with its environment.');
	for (const name of [project, environment.SCAPE_PAGES_PROJECT, environment.CF_PAGES_PROJECT_NAME]) {
		if (name !== undefined && name !== productId) throw new Error('Pages deployment project must match its selected product.');
	}
	if (environment.SCAPE_FRAMESCAPER_LINE && environment.SCAPE_FRAMESCAPER_LINE !== 'baseline') throw new Error('The development successor cannot replace an ordinary product Pages site.');
	const { site } = webBuildRouting({ ...environment, SCAPE_PRODUCT: productId });
	if (site.protocol !== 'https:' || site.username || site.password) throw new Error('Pages deployment requires an HTTPS origin without credentials.');
	const origin = site.origin;
	for (const peer of PRODUCTS.filter(value => value !== productId)) {
		const configured = environment[`${peer.toUpperCase()}_SITE`];
		if (origin === `https://${peer}.org` || (configured && origin === new URL(configured).origin)) throw new Error('Pages deployment origin belongs to a peer product.');
	}
	if (environment.SCAPE_DEPLOY_AUDIT_ORIGIN && environment.SCAPE_DEPLOY_AUDIT_ORIGIN !== origin) throw new Error('Pages deployment audit origin differs from its configured product origin.');
	return Object.freeze({ productId, projectName: productId, origin });
}

/** A build's identity must be checked before the first upload, even outside release CI. */
export async function assertPagesBuildIdentity(directory: string, plan: PagesDeploymentPlan): Promise<void> {
	const document = await boundedText(join(directory, 'en/index.html'));
	if (!document.includes(`data-product="${plan.productId}"`) || !document.includes(`href="${plan.origin}/en/"`)) throw new Error('Pages build product or canonical origin differs from the selected deployment.');
	await boundedText(join(directory, `manifest-${plan.productId}.webmanifest`));
	const value: unknown = JSON.parse(await boundedText(join(directory, 'offline-shell.json')));
	if (!value || typeof value !== 'object' || !('workers' in value) || !value.workers || typeof value.workers !== 'object'
		|| Object.keys(value.workers).join() !== plan.productId) throw new Error('Pages offline shell belongs to a different product.');
}
async function boundedText(path: string): Promise<string> {
	const metadata = await lstat(path);
	if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1 || metadata.size > 8 * 1024 * 1024) throw new Error('Pages identity must be a bounded regular file.');
	return readFile(path, 'utf8');
}
export async function deployProductPages(options: Selection & { root: string; run?: (command: PagesDeploymentCommand) => Promise<void> }): Promise<void> {
	const plan = resolvePagesDeploymentPlan(options);
	const environment = { ...options.environment, SCAPE_PRODUCT: plan.productId, SCAPE_DEPLOY_AUDIT_ORIGIN: plan.origin };
	const run = options.run ?? runPagesCommand;
	await run({ root: options.root, environment, args: ['run', 'build:pages'] });
	await assertPagesBuildIdentity(join(options.root, 'dist'), plan);
	await run({ root: options.root, environment, args: ['exec', '--', 'wrangler', 'pages', 'deploy', 'dist', `--project-name=${plan.projectName}`] });
	await run({ root: options.root, environment: { ...environment, SCAPE_DEPLOY_EXPECTED_OFFLINE_SHELL: join(options.root, 'dist/offline-shell.json') }, args: ['run', 'verify:pages'] });
}

/* SPDX-License-Identifier: AGPL-3.0-only */
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { ordinaryBrowserProductSitePlan } from '../../../scripts/lib/browser-product-site-plan.mjs';
import { recordBrowserProductBuildEvidence, verifyBrowserProductBuildEvidence } from '../../../scripts/lib/browser-product-site-evidence.mjs';
import { expectedBrowserCoverageRevision } from '../../../scripts/lib/browser-build-source-revision.mjs';
import { sourceMapDirectoryFor } from '../../../scripts/lib/build-source-map-relocation.mjs';
import { startPagesSiteStaticServer } from '../../../scripts/lib/pages-site-static-server.mjs';

interface MotionSite {
	readonly productId: 'motionscaper';
	readonly origin: string;
	readonly outputDirectory: string;
	readonly peerOrigin?: string;
}
interface OfflineSiteOptions {
	readonly repositoryRoot?: string;
	readonly environment?: Readonly<Record<string, string | undefined>>;
}
const defaultRepositoryRoot = resolve(import.meta.dirname, '../../..');

/** Rehost authenticated bytes at a disposable real origin for all-engine offline tests. */
export async function createMotionscaperOfflineSite(source?: MotionSite, options: OfflineSiteOptions = {}) {
	const repositoryRoot = options.repositoryRoot ?? defaultRepositoryRoot;
	const environment = options.environment ?? process.env;
	const portable = environment.SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT !== undefined;
	const original = portable ? portableSite(repositoryRoot, environment, source) : source ?? ordinarySite(environment);
	// Stage authority is independently admitted by the packaged launcher. Never
	// derive this expected revision from the site/clone evidence being checked.
	const sourceRevision: string = await expectedBrowserCoverageRevision(repositoryRoot, { requireStage: portable });
	const identity = { ...original, outputDirectory: resolve(repositoryRoot, original.outputDirectory), sourceRevision };
	const evidence = await verifyBrowserProductBuildEvidence(identity);
	const prefix = portable ? join(environment.SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT!, 'motion-offline-')
		: `${dirname(identity.outputDirectory)}-motion-offline-`;
	const parent = await mkdtemp(prefix);
	const directory = join(parent, basename(original.outputDirectory));
	let server: Awaited<ReturnType<typeof startPagesSiteStaticServer>> | undefined;
	try {
		await cp(identity.outputDirectory, directory, { recursive: true });
		if (Object.keys(evidence.sourceMaps).length > 0) {
			await cp(sourceMapDirectoryFor(identity.outputDirectory), sourceMapDirectoryFor(directory), { recursive: true });
		}
		const copied = { ...identity, outputDirectory: directory };
		// Authenticate the copy before re-recording the ephemeral origin.
		await verifyBrowserProductBuildEvidence(copied);
		server = await startPagesSiteStaticServer({ root: directory });
		const relocated = { ...copied, origin: server.baseURL };
		await recordBrowserProductBuildEvidence(relocated);
		await verifyBrowserProductBuildEvidence(relocated);
		const descriptor = Object.freeze({ ...original, origin: server.baseURL,
			outputDirectory: portable ? directory : relative(repositoryRoot, directory).replaceAll('\\', '/') });
		const active = server;
		return Object.freeze({
			baseURL: active.baseURL, descriptor,
			close: () => active.close(),
			async dispose() { await active.close(); await rm(parent, { recursive: true, force: true }); },
		});
	} catch (error) {
		try { await server?.close(); } finally { await rm(parent, { recursive: true, force: true }); }
		throw error;
	}
}
function ordinarySite(environment: Readonly<Record<string, string | undefined>>): MotionSite {
	const site = ordinaryBrowserProductSitePlan(environment).sites.find(site => site.productId === 'motionscaper');
	if (!site) throw new Error('The ordinary Motion browser site is absent.');
	return { ...site, productId: 'motionscaper' };
}
function portableSite(root: string, environment: Readonly<Record<string, string | undefined>>, source?: MotionSite): MotionSite {
	if (!isAbsolute(root) || environment.SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT !== root
		|| !isAbsolute(environment.SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT ?? '')) {
		throw new Error('Portable offline sites require the launcher payload and writable run roots.');
	}
	const sites = JSON.parse(environment.SCAPE_BROWSER_COVERAGE_SITES ?? 'null') as MotionSite[] | null;
	const origins = JSON.parse(environment.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS ?? 'null') as Record<string, unknown> | null;
	const matches = sites?.filter(site => site.productId === 'motionscaper');
	if (matches?.length !== 1) throw new Error('Portable offline coverage requires one declared Motion site.');
	const original = matches[0]!;
	const url = new URL(original.origin);
	if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.origin !== original.origin
		|| origins?.motionscaper !== original.origin || original.outputDirectory !== join(root, 'sites/motionscaper')
		|| source && (source.origin !== original.origin || source.outputDirectory !== original.outputDirectory || source.productId !== original.productId)) {
		throw new Error('Portable offline coverage must retain the launcher Motion site authority.');
	}
	return original;
}

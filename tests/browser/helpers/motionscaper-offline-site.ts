/* SPDX-License-Identifier: AGPL-3.0-only */
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { ordinaryBrowserProductSitePlan } from '../../../scripts/lib/browser-product-site-plan.mjs';
import { recordBrowserProductSiteEvidence, verifyBrowserProductSite } from '../../../scripts/lib/browser-product-test-sites.mjs';
import { sourceMapDirectoryFor } from '../../../scripts/lib/build-source-map-relocation.mjs';
import { startPagesSiteStaticServer } from '../../../scripts/lib/pages-site-static-server.mjs';

interface MotionSite {
	readonly productId: 'motionscaper';
	readonly origin: string;
	readonly outputDirectory: string;
	readonly peerOrigin?: string;
}
const repositoryRoot = resolve(import.meta.dirname, '../../..');

/** Rehost authenticated bytes at a disposable real origin for all-engine offline tests. */
export async function createMotionscaperOfflineSite(source?: MotionSite) {
	const ordinary = ordinaryBrowserProductSitePlan().sites.find(site => site.productId === 'motionscaper');
	const original = source ?? (ordinary ? { ...ordinary, productId: 'motionscaper' as const } : undefined);
	if (!original) throw new Error('The ordinary Motion browser site is absent.');
	const evidence = await verifyBrowserProductSite(original);
	// A sibling parent preserves the map's relative depth as well as its exact bytes.
	const parent = await mkdtemp(`${dirname(resolve(repositoryRoot, original.outputDirectory))}-motion-offline-`);
	const directory = join(parent, basename(original.outputDirectory));
	let server: Awaited<ReturnType<typeof startPagesSiteStaticServer>> | undefined;
	try {
		await cp(resolve(repositoryRoot, original.outputDirectory), directory, { recursive: true });
		if (Object.keys(evidence.sourceMaps).length > 0) {
			await cp(sourceMapDirectoryFor(resolve(repositoryRoot, original.outputDirectory)), sourceMapDirectoryFor(directory), { recursive: true });
		}
		const copied = { ...original, outputDirectory: relative(repositoryRoot, directory).replaceAll('\\', '/') };
		// Check the copied original inventory before recording the new origin, so a
		// concurrent source mutation cannot be silently blessed during rehosting.
		await verifyBrowserProductSite(copied);
		server = await startPagesSiteStaticServer({ root: directory });
		const descriptor = Object.freeze({ ...copied, origin: server.baseURL });
		await recordBrowserProductSiteEvidence(descriptor);
		await verifyBrowserProductSite(descriptor);
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

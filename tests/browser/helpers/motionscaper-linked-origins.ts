/* SPDX-License-Identifier: AGPL-3.0-only */
import { isAbsolute } from 'node:path';
import { connect } from 'node:net';
import { verifyBrowserProductBuildEvidence } from '../../../scripts/lib/browser-product-site-evidence.mjs';
import { startPagesSiteStaticServer } from '../../../scripts/lib/pages-site-static-server.mjs';

export interface MotionLinkedSite {
	readonly productId: 'framescaper' | 'motionscaper';
	readonly origin: string;
	readonly outputDirectory: string;
}

/** Dedicated links only: exact reciprocal origins, no clone or artifact re-identification. */
export async function createMotionLinkedOrigins(sites: readonly MotionLinkedSite[], sourceRevision: string) {
	if (sites.length !== 2 || sites[0]?.productId !== 'framescaper' || sites[1]?.productId !== 'motionscaper'
		|| sites[0].origin === sites[1].origin) throw new Error('The linked workflow requires exactly its two product origins.');
	for (const site of sites) {
		const url = new URL(site.origin);
		if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.origin !== site.origin
			|| !isAbsolute(site.outputDirectory)) throw new Error('Linked origins must name exact loopback sites.');
		await verifyBrowserProductBuildEvidence({ ...site, sourceRevision });
	}
	const servers: Awaited<ReturnType<typeof startPagesSiteStaticServer>>[] = [];
	async function close(): Promise<void> {
		const errors: unknown[] = [];
		for (const server of servers) { try { await server.close(); } catch (error) { errors.push(error); } }
		if (errors.length) throw new AggregateError(errors, 'Linked origin cleanup failed.');
	}
	try {
		for (const site of sites) {
			const server = await startPagesSiteStaticServer({ root: site.outputDirectory, port: Number(new URL(site.origin).port) });
			servers.push(server);
			if (server.baseURL !== site.origin) throw new Error('Linked origin changed at bind.');
		}
	} catch (error) {
		try { await close(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Linked origin startup and cleanup failed.', { cause: cleanup }); }
		throw error;
	}
	return Object.freeze({
		sites: [...sites],
		async close() {
			await close();
			for (const site of sites) await requireClosedPort(site.origin);
		},
		async dispose() {
			await close();
			for (const site of sites) await verifyBrowserProductBuildEvidence({ ...site, sourceRevision });
		},
	});
}

function requireClosedPort(origin: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const socket = connect({ host: '127.0.0.1', port: Number(new URL(origin).port) });
		socket.setTimeout(2_000);
		socket.once('connect', () => { socket.destroy(); reject(new Error(`Linked origin remains reachable: ${origin}`)); });
		socket.once('timeout', () => { socket.destroy(); reject(new Error(`Linked origin closure was not observed: ${origin}`)); });
		socket.once('error', (error: NodeJS.ErrnoException) => {
			socket.destroy(); if (error.code === 'ECONNREFUSED') resolve(); else reject(error);
		});
	});
}

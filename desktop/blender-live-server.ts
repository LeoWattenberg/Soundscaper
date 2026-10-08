/* SPDX-License-Identifier: AGPL-3.0-only */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

export interface BlenderLiveServer {
	readonly descriptor: Readonly<{ schemaVersion: 1; host: '127.0.0.1'; port: number; token: string }>;
	publish(revision: number, manifest: string): void;
	close(): Promise<void>;
}

/** Loopback metadata IPC: no filesystem route and no browser-origin access. */
export async function createBlenderLiveServer(isActive: () => boolean): Promise<BlenderLiveServer> {
	const token = randomBytes(32).toString('hex');
	const authorization = Buffer.from(`Bearer ${token}`);
	let current: { revision: number; manifest: string } | null = null;
	let closed = false;
	let closePromise: Promise<void> | null = null;
	const server = createServer({ maxHeaderSize: 4096 }, (request, response) => {
		response.setHeader('Cache-Control', 'no-store');
		response.setHeader('Connection', 'close');
		const credentials = Buffer.from(request.headers.authorization ?? '');
		if (closed || !isActive() || request.headers.origin !== undefined
			|| credentials.byteLength !== authorization.byteLength || !timingSafeEqual(credentials, authorization)) {
			response.writeHead(403).end();
			return;
		}
		if (request.method !== 'GET') {
			response.writeHead(405, { Allow: 'GET' }).end();
			return;
		}
		if (!request.url || request.url.length > 256 || !/^\/snapshot\?after=\d{1,16}$/u.test(request.url)) {
			response.writeHead(404).end();
			return;
		}
		const after = Number(request.url.slice('/snapshot?after='.length));
		if (!Number.isSafeInteger(after)) {
			response.writeHead(400).end();
			return;
		}
		if (!current || after >= current.revision) {
			response.writeHead(204).end();
			return;
		}
		response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(current.manifest);
	});
	server.maxConnections = 8;
	server.requestTimeout = 2000;
	server.headersTimeout = 2000;
	server.keepAliveTimeout = 1000;
	server.setTimeout(2000, (socket) => socket.destroy());
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			server.removeListener('error', reject);
			resolve();
		});
	});
	// An operating-system socket error must not become an uncaught main-process error.
	server.on('error', () => { closed = true; });
	const address = server.address();
	if (!address || typeof address === 'string') {
		server.close();
		throw new Error('Blender IPC did not bind a loopback port');
	}
	return {
		descriptor: Object.freeze({ schemaVersion: 1, host: '127.0.0.1', port: address.port, token }),
		publish(revision, manifest) {
			if (closed) throw new Error('Blender live IPC has stopped');
			current = { revision, manifest };
		},
		close() {
			if (closePromise) return closePromise;
			closed = true;
			current = null;
			closePromise = new Promise<void>((resolve, reject) => {
				server.close((error) => error ? reject(error) : resolve());
				server.closeAllConnections();
			});
			return closePromise;
		},
	};
}

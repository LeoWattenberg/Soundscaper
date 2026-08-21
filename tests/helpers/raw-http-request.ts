/* SPDX-License-Identifier: AGPL-3.0-only */

import { request } from 'node:http';

export function rawHttpRequest(baseURL: string, path: string): Promise<{ readonly statusCode: number | undefined }> {
	return new Promise((resolvePromise, reject) => {
		const url = new URL(baseURL);
		const clientRequest = request({
			hostname: url.hostname,
			port: url.port,
			method: 'GET',
			path,
		}, (response) => {
			response.resume();
			response.once('end', () => resolvePromise({ statusCode: response.statusCode }));
		});
		clientRequest.once('error', reject);
		clientRequest.end();
	});
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';

import {
	activateOfflineShell,
	handleApplicationShellFetch,
	installOfflineShell,
	offlineShellFunctionSources,
	validateOfflineShellConfiguration,
} from './offline-shell-worker.mjs';

export { activateOfflineShell, installOfflineShell, validateOfflineShellConfiguration };

const CONFIGURATION_TOKEN = '__SOUNDSCAPER_OFFLINE_SHELL_CONFIGURATION__';

export function offlineServiceWorkerTemplateSha256() {
	return createHash('sha256').update(serviceWorkerTemplate()).digest('hex');
}

export function renderOfflineServiceWorker(configuration) {
	const template = serviceWorkerTemplate();
	if (!template.includes(CONFIGURATION_TOKEN)) throw new Error('Offline service worker template token is missing.');
	return template.replace(CONFIGURATION_TOKEN, JSON.stringify(configuration));
}

export async function handleOfflineShellFetch({
	configuration,
	cacheStorage,
	fetchImpl,
	request,
	origin,
	cryptoImpl = globalThis.crypto,
}) {
	if (request.method !== 'GET') return fetchImpl(request);
	const shellResponse = await handleApplicationShellFetch({
		configuration,
		cacheStorage,
		fetchImpl,
		request,
		origin,
		cryptoImpl,
	});
	return shellResponse ?? fetchImpl(request);
}

function attachOfflineServiceWorker(scope, configuration) {
	scope.addEventListener('install', (event) => {
		event.waitUntil(installOfflineShell({
			configuration,
			cacheStorage: scope.caches,
			fetchImpl: scope.fetch.bind(scope),
			cryptoImpl: scope.crypto,
		}));
	});
	scope.addEventListener('activate', (event) => {
		event.waitUntil(activateOfflineShell({
			configuration,
			cacheStorage: scope.caches,
			clients: scope.clients,
		}));
	});
	scope.addEventListener('fetch', (event) => {
		if (event.request.method !== 'GET') return;
		event.respondWith(handleOfflineShellFetch({
			configuration,
			cacheStorage: scope.caches,
			fetchImpl: scope.fetch.bind(scope),
			request: event.request,
			origin: scope.location.origin,
		}));
	});
}

function serviceWorkerTemplate() {
	return `/* SPDX-License-Identifier: AGPL-3.0-only */
'use strict';
const OFFLINE_SHELL = ${CONFIGURATION_TOKEN};
${offlineShellFunctionSources()}
${handleOfflineShellFetch.toString()}
${attachOfflineServiceWorker.toString()}
attachOfflineServiceWorker(globalThis, OFFLINE_SHELL);
`;
}

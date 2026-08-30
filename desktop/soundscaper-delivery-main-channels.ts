/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed, pathless persistent-delivery main/preload boundary. */
export const SOUNDSCAPER_DELIVERY_MAIN_CHANNELS = Object.freeze({
	selectRoot: 'soundscaper:v1:delivery:root:select',
	reauthorizeRoot: 'soundscaper:v1:delivery:root:reauthorize',
	projectIdentity: 'soundscaper:v1:delivery:project:identity',
	enqueueBatch: 'soundscaper:v1:delivery:queue:enqueue-batch',
	list: 'soundscaper:v1:delivery:queue:list',
	events: 'soundscaper:v1:delivery:queue:events',
	pause: 'soundscaper:v1:delivery:queue:pause',
	resume: 'soundscaper:v1:delivery:queue:resume',
	reorder: 'soundscaper:v1:delivery:queue:reorder',
	cancel: 'soundscaper:v1:delivery:queue:cancel',
	retry: 'soundscaper:v1:delivery:queue:retry',
});

/** Private transferred-port entrypoint; never exposed through `ipcRenderer.invoke`. */
export const SOUNDSCAPER_DELIVERY_WORKER_PORT_CHANNEL =
	'soundscaper:v1:delivery:worker:port';

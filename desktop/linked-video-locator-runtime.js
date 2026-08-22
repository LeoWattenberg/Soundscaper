/* SPDX-License-Identifier: AGPL-3.0-only */

import { FileDesktopLinkedVideoLocatorRegistry } from './project-library-runtime/desktop/linked-video-locator-registry.js';
import { DesktopLinkedVideoLocatorStore } from './project-library-runtime/desktop/linked-video-locator-store.js';
import { registerDesktopLinkedVideoLocatorIpc } from './linked-video-locator-ipc.js';
import { acceptsFile, mimeTypeForPath } from './validation.js';

/** Composes the persisted main-process locator store without exposing it. */
export function createDesktopLinkedVideoLocatorRuntime({ readCapabilities, registryPath }) {
	const store = new DesktopLinkedVideoLocatorStore({
		readCapabilities,
		registry: new FileDesktopLinkedVideoLocatorRegistry(registryPath),
	});
	return Object.freeze({
		dispose: () => store.dispose(),
		ready: () => store.ready(),
		watchImportAuthority: () => Object.freeze({
			registerPath: (path, options) => {
				if (!acceptsFile('video', path)) throw new TypeError('A watched linked locator requires a video file type.');
				return store.registerPath(path, {
					kind: 'video', owner: options.owner, displayName: options.displayName,
					mimeType: mimeTypeForPath(path),
				});
			},
			release: (locator, owner) => store.release(locator.locatorId, {
				owner, expectedRevision: locator.locatorRevision, expectedKind: 'video',
			}),
		}),
		registerIpc: (options) => registerDesktopLinkedVideoLocatorIpc({
			...options,
			releaseRead: (id, owner) => readCapabilities.release(id, { owner }),
			store,
		}),
		revokeOwner: (owner) => store.revokeOwner(owner),
	});
}

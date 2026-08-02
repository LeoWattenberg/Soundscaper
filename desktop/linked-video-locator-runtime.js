/* SPDX-License-Identifier: AGPL-3.0-only */

import { FileDesktopLinkedVideoLocatorRegistry } from './project-library-runtime/desktop/linked-video-locator-registry.js';
import { DesktopLinkedVideoLocatorStore } from './project-library-runtime/desktop/linked-video-locator-store.js';
import { registerDesktopLinkedVideoLocatorIpc } from './linked-video-locator-ipc.js';

/** Composes the persisted main-process locator store without exposing it. */
export function createDesktopLinkedVideoLocatorRuntime({ readCapabilities, registryPath }) {
	const store = new DesktopLinkedVideoLocatorStore({
		readCapabilities,
		registry: new FileDesktopLinkedVideoLocatorRegistry(registryPath),
	});
	return Object.freeze({
		dispose: () => store.dispose(),
		ready: () => store.ready(),
		registerIpc: (options) => registerDesktopLinkedVideoLocatorIpc({ ...options, store }),
		revokeOwner: (owner) => store.revokeOwner(owner),
	});
}

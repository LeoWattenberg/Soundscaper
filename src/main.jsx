import { createRoot } from 'react-dom/client';

import App, { applyDocumentRoute } from './common/site/App.jsx';
import {
	APPLICATION_READY_EVENT,
	APPLICATION_READY_SELECTOR,
} from './common/site/application-ready-scheduler.js';
import { BUILT_PRODUCT_ID, resolveApplicationRoute } from './common/site/route.js';
import { editorStartupProgress } from './common/site/editor-startup-progress.ts';
import { scheduleOfflineApplicationShellRegistration } from './common/offline/application-shell.ts';
import { installStaleBuildDetection } from './common/offline/stale-build-runtime.ts';

const applicationRoot = document.getElementById('app');
const initialLoadProgress = document.querySelector('[data-initial-load-progress]');
let applicationReady = false;
const markApplicationReady = () => {
	if (applicationReady || !applicationRoot.querySelector(APPLICATION_READY_SELECTOR)) return;
	applicationReady = true;
	readinessObserver.disconnect();
	editorStartupProgress.finish();
	initialLoadProgress?.remove();
	window.dispatchEvent(new Event(APPLICATION_READY_EVENT));
};
const readinessObserver = new MutationObserver(markApplicationReady);
readinessObserver.observe(applicationRoot, { childList: true, subtree: true });
markApplicationReady();

editorStartupProgress.start(BUILT_PRODUCT_ID);

// `import.meta.url` names this document's own built entry chunk, which is what
// lets a failed lazy load be checked against the inventory the origin is
// currently serving instead of guessed at. Installed before the first render so
// no chunk can fail ahead of the listener that explains it.
installStaleBuildDetection({ moduleUrl: import.meta.url });

const route = await resolveApplicationRoute(window);
applyDocumentRoute(route);
createRoot(applicationRoot).render(<App route={route} />);
if (import.meta.env.PROD) {
	void scheduleOfflineApplicationShellRegistration({
		desktop: route.desktop,
		productId: route.productId,
	});
}

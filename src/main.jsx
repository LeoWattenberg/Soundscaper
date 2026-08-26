import { createRoot } from 'react-dom/client';

import App, { applyDocumentRoute } from './common/site/App.jsx';
import { APPLICATION_READY_EVENT } from './common/site/application-ready-scheduler.js';
import { resolveApplicationRoute } from './common/site/route.js';
import { registerOfflineApplicationShell } from './common/offline/application-shell.ts';

const applicationRoot = document.getElementById('app');
const initialLoadProgress = document.querySelector('[data-initial-load-progress]');
let applicationReady = false;
const markApplicationReady = () => {
	if (applicationReady || !applicationRoot.querySelector('[data-audio-editor-bound="true"], [role="alert"]')) return;
	applicationReady = true;
	readinessObserver.disconnect();
	initialLoadProgress?.remove();
	window.dispatchEvent(new Event(APPLICATION_READY_EVENT));
};
const readinessObserver = new MutationObserver(markApplicationReady);
readinessObserver.observe(applicationRoot, { childList: true, subtree: true });
markApplicationReady();

const route = await resolveApplicationRoute(window);
applyDocumentRoute(route);
createRoot(applicationRoot).render(<App route={route} />);
if (import.meta.env.PROD) {
	void registerOfflineApplicationShell({ desktop: route.desktop });
}

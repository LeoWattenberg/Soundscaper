import { createRoot } from 'react-dom/client';

import App, { applyDocumentRoute } from './common/site/App.jsx';
import { resolveApplicationRoute } from './common/site/route.js';
import { registerOfflineApplicationShell } from './common/offline/application-shell.ts';

const applicationRoot = document.getElementById('app');
const initialLoadProgress = document.querySelector('[data-initial-load-progress]');
const readinessObserver = initialLoadProgress ? new MutationObserver(() => {
	if (!applicationRoot.querySelector('[data-audio-editor-bound], [role="alert"]')) return;
	readinessObserver.disconnect();
	initialLoadProgress.remove();
}) : null;
readinessObserver?.observe(applicationRoot, { childList: true, subtree: true });

const route = await resolveApplicationRoute(window);
applyDocumentRoute(route);
createRoot(applicationRoot).render(<App route={route} />);
if (import.meta.env.PROD) {
	void registerOfflineApplicationShell({ desktop: route.desktop });
}

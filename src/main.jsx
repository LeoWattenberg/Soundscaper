import { createRoot } from 'react-dom/client';

import App, { applyDocumentRoute } from './common/site/App.jsx';
import { resolveApplicationRoute } from './common/site/route.js';
import { registerOfflineApplicationShell } from './common/offline/application-shell.ts';

const route = await resolveApplicationRoute(window);
applyDocumentRoute(route);
createRoot(document.getElementById('app')).render(<App route={route} />);
if (import.meta.env.PROD) {
	void registerOfflineApplicationShell({ desktop: route.desktop });
}

import { createRoot } from 'react-dom/client';

import App, { applyDocumentRoute } from './common/site/App.jsx';
import { resolveApplicationRoute } from './common/site/route.js';

const route = await resolveApplicationRoute(window);
applyDocumentRoute(route);
createRoot(document.getElementById('app')).render(<App route={route} />);

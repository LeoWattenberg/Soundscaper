// Node customization hooks that stub stylesheet and binary-asset imports so
// node-run tests can execute component modules from the vendored design
// system (vendor/audacity-design-system), whose .tsx files import their own
// CSS and images. Vite handles these imports in the real build; under
// `node --import tsx` they would throw ERR_UNKNOWN_FILE_EXTENSION.
//
// Usage: node --import tsx --import ./scripts/node-style-asset-loader.mjs ...
// (works in either --import order, and covers the CJS require path too).
import { registerHooks } from 'node:module';

const STYLE_EXTENSIONS = /\.css$/u;
// Assets resolve to a default string export, mirroring Vite's asset modules.
const ASSET_EXTENSIONS = /\.(?:ttf|otf|woff2?|png|jpe?g|gif|webp|svg|avif)$/u;

function pathnameOf(url) {
	try {
		return new URL(url).pathname;
	} catch {
		return url;
	}
}

registerHooks({
	load(url, context, nextLoad) {
		const pathname = pathnameOf(url);
		if (STYLE_EXTENSIONS.test(pathname)) {
			return { format: 'module', source: 'export {};', shortCircuit: true };
		}
		if (ASSET_EXTENSIONS.test(pathname)) {
			return { format: 'module', source: "export default '';", shortCircuit: true };
		}
		return nextLoad(url, context);
	},
});

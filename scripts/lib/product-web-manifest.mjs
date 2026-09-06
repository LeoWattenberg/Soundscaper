/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The web application manifest one product installs.
 *
 * Installability is only the first half of it: the fields past `icons` are what
 * decide whether an installed editor behaves like an application — which files
 * the operating system hands it, how a second launch reaches the window that is
 * already open, and what a jump list offers before there is a window at all.
 * The offline shell owns the assets; this module owns what the manifest says
 * about them.
 */

/**
 * The project archive every product opens.
 *
 * These are copies of `SCAPE_MIME_TYPE` and `ACCEPTED_PROJECT_FILE_EXTENSIONS`,
 * which live in TypeScript modules this file cannot import: the build runs
 * under plain node with no loader. The offline-shell build test imports the
 * originals and holds these copies to them, so the two can only drift past a
 * failing test.
 */
export const SCAPE_PROJECT_MIME_TYPE = 'application/vnd.soundscaper.scape+zip';
export const PROJECT_FILE_EXTENSIONS = Object.freeze(['.sscape', '.fscape', '.liscape', '.scape']);

/**
 * The media a product hands the operating system, by kind.
 *
 * Every entry is a type the import picker already advertises in
 * `AUDIO_EDITOR_AUDIO_FILE_ACCEPT`, spelled out: `audio/*` is something a file
 * input may say and a file handler may not, so the wildcard is replaced by the
 * registered types behind it. WavPack (`.wv`) imports but has no agreed media
 * type and is deliberately absent: registering a handler is a claim on every
 * file of that kind on the machine, and it is made only for named types.
 */
export const MEDIA_FILE_TYPES = Object.freeze({
	audio: Object.freeze({
		'audio/aac': Object.freeze(['.aac']),
		'audio/aiff': Object.freeze(['.aif', '.aiff']),
		'audio/flac': Object.freeze(['.flac']),
		'audio/mp4': Object.freeze(['.m4a']),
		'audio/mpeg': Object.freeze(['.mp2', '.mp3']),
		'audio/ogg': Object.freeze(['.oga', '.ogg']),
		'audio/opus': Object.freeze(['.opus']),
		'audio/wav': Object.freeze(['.rf64', '.wav']),
	}),
	video: Object.freeze({
		'video/mp4': Object.freeze(['.m4v', '.mp4']),
		'video/webm': Object.freeze(['.webm']),
	}),
});

/**
 * Where a shared file arrives, and under which form field.
 *
 * A share target is the receiving half of the operating system's share sheet:
 * the manifest declares one path inside the product scope, and the service
 * worker answers the `POST` that lands there. Both halves are named here
 * because the declaration and the worker must agree exactly — a worker
 * answering a path the manifest never declared is dead code, and a declared
 * path no worker answers is a share that navigates to nothing.
 */
export const SHARE_TARGET_PATH = 'share-target';
export const SHARE_TARGET_FILES_FIELD = 'media';

/**
 * The install-dialog screenshots each product commits, by form factor.
 *
 * A manifest without screenshots is installed from a one-line mini-bar; a
 * manifest with them gets the richer dialog that shows the editor itself. The
 * images are real captures of the built product, taken by
 * `scripts/capture-install-screenshots.mjs`, because a mock in an install
 * dialog is a promise about an interface that does not exist. Chrome requires every image to declare the
 * size it genuinely is, so these dimensions are the capture viewport as well as
 * the declaration, and that script's `--check` holds the committed files to them.
 */
export const INSTALL_SCREENSHOT_DIRECTORY = 'install-screenshots';
export const INSTALL_SCREENSHOTS = Object.freeze([
	Object.freeze({
		formFactor: 'wide',
		width: 1280,
		height: 800,
		label: 'The editor in a desktop window: a multitrack timeline of clips, '
			+ 'the track controls beside it, and the transport above.',
	}),
	Object.freeze({
		formFactor: 'narrow',
		width: 720,
		height: 1280,
		label: 'The editor in a phone-sized window: the same timeline and transport, '
			+ 'with the menubar and toolbars folded into their drawer.',
	}),
]);

/** Every screenshot file one product commits, without its directory or suffix. */
export function productScreenshotNames(productId) {
	return INSTALL_SCREENSHOTS.map(({ formFactor }) => `${productId}-${formFactor}`);
}

/** The screenshot resources one product's manifest declares, in dialog order. */
export function productInstallScreenshots(productId) {
	return INSTALL_SCREENSHOTS.map(({ formFactor, width, height, label }) => ({
		src: `${INSTALL_SCREENSHOT_DIRECTORY}/${productId}-${formFactor}.png`,
		sizes: `${String(width)}x${String(height)}`,
		type: 'image/png',
		form_factor: formFactor,
		label,
	}));
}

/**
 * The two surfaces `src/common/site/site.css` paints, copied here because the
 * build runs under plain node with no CSS loader: `--color-surface` under
 * `:root` and under `:root[data-theme='dark']`. The install test parses the
 * stylesheet and holds these copies to it, so the two can only drift past a
 * failing test.
 */
export const SITE_LIGHT_SURFACE_COLOR = '#ffffff';
export const SITE_DARK_SURFACE_COLOR = '#14100d';

/** Sizes every product rasterizes, and the subset a maskable icon needs. */
export const ICON_SIZES = Object.freeze([180, 192, 512]);
export const MANIFEST_ICON_SIZES = Object.freeze([192, 512]);

/** Every icon file one product rasterizes, without their directory or suffix. */
export function productIconNames(productId) {
	return [
		...ICON_SIZES.map((size) => `${productId}-${size}`),
		...MANIFEST_ICON_SIZES.map((size) => `${productId}-maskable-${size}`),
	];
}

/**
 * The manifest that makes an installed editor an application.
 *
 * Everything past `icons` is operating-system integration rather than
 * installability. `launch_handler` carries the most weight: these editors hold
 * a project in IndexedDB, and a second window over one database is exactly the
 * corruption `navigate-existing` exists to prevent, so an opened file and a
 * jump-list shortcut both steer the window that is already running.
 */
export function productWebManifest(product) {
	return {
		id: `/${product.id}`,
		name: product.name,
		short_name: product.name,
		description: product.description,
		lang: 'en',
		dir: 'ltr',
		start_url: product.startUrl,
		scope: product.scope,
		display: 'standalone',
		display_override: ['window-controls-overlay', 'standalone'],
		orientation: 'any',
		categories: [...product.categories],
		// The splash screen, painted before a line of the application has run.
		// It is the light surface for two reasons that agree: the document it
		// hands over to paints that surface until the theme script has read the
		// visitor's preference, so a light splash is the one that does not flash;
		// and the icon drawn on the splash is the `any` raster, which carries no
		// plate of its own, so the solid black Soundscaper mark would vanish into
		// the dark surface exactly as it would into a dark maskable plate.
		background_color: SITE_LIGHT_SURFACE_COLOR,
		// The chrome around an installed window, and the dark surface rather than
		// the light one: a manifest may declare a single colour with no media
		// query, while the document head states both and a browser prefers what
		// the head says. So the light window is already covered, and the value
		// left to declare is the one that keeps a dark window from showing a seam
		// between the chrome and the page. `scripts/generate-static-routes.mjs`
		// reads this field for the head's dark `theme-color` meta.
		theme_color: SITE_DARK_SURFACE_COLOR,
		icons: [
			...MANIFEST_ICON_SIZES.map((size) => manifestIcon(product.id, size, 'any')),
			...MANIFEST_ICON_SIZES.map((size) => manifestIcon(product.id, size, 'maskable')),
		],
		screenshots: productInstallScreenshots(product.id),
		launch_handler: { client_mode: ['navigate-existing', 'auto'] },
		file_handlers: productFileHandlers(product),
		share_target: productShareTarget(product),
		shortcuts: productShortcuts(product),
	};
}

function manifestIcon(productId, size, purpose) {
	const name = purpose === 'maskable' ? `${productId}-maskable-${size}` : `${productId}-${size}`;
	return { src: `offline-icons/${name}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose };
}

/**
 * What double-clicking a file in the operating system's file manager opens.
 *
 * A project archive is one handler and the media a product edits is another, so
 * a machine with both products installed can associate each product with its
 * own suffix while both still open every Scape archive. The action is the
 * localized entry the manifest already starts at, which is the only document
 * inside the scope that boots the editor.
 */
function productFileHandlers(product) {
	return [
		{
			name: `${product.name} project`,
			action: product.startUrl,
			accept: { [SCAPE_PROJECT_MIME_TYPE]: [...PROJECT_FILE_EXTENSIONS] },
			icons: [manifestIcon(product.id, 192, 'any')],
		},
		{
			name: product.media.includes('video') ? 'Audio and video' : 'Audio',
			action: product.startUrl,
			accept: productMediaAccept(product),
			icons: [manifestIcon(product.id, 192, 'any')],
		},
	];
}

/** The media types one product handles, with the suffixes each is known by. */
function productMediaAccept(product) {
	return Object.fromEntries(product.media.flatMap((kind) => Object
		.entries(MEDIA_FILE_TYPES[kind])
		.map(([type, extensions]) => [type, [...extensions]])));
}

/**
 * What the operating system's share sheet may hand a running editor.
 *
 * The types are the media file handler's, read from that handler's own list
 * rather than restated: a product that accepts a share it cannot open puts an
 * editor in a share sheet that will refuse the file, and the only way two lists
 * cannot drift is for there to be one list. Suffixes are left out because a
 * share carries a media type and no filename its sender is bound to.
 *
 * `POST` with `multipart/form-data` is the only shape that can carry files at
 * all, and the field name is what the service worker reads them out of. The
 * action is a path inside the product scope, which is what makes the scope's
 * own worker the one that answers it.
 */
function productShareTarget(product) {
	return {
		action: `${product.scope}${SHARE_TARGET_PATH}`,
		method: 'POST',
		enctype: 'multipart/form-data',
		params: {
			files: [{ name: SHARE_TARGET_FILES_FIELD, accept: Object.keys(productMediaAccept(product)) }],
		},
	};
}

/**
 * The jump-list entries an installed editor offers before it has a window.
 *
 * Both land on the same document the application starts at, so a runtime that
 * never reads the launch query still opens the editor rather than failing.
 */
function productShortcuts(product) {
	return [
		{
			name: 'New project',
			short_name: 'New',
			url: `${product.startUrl}?launch=new-project`,
			icons: [manifestIcon(product.id, 192, 'any')],
		},
		{
			name: 'Open a project',
			short_name: 'Open',
			url: `${product.startUrl}?launch=open-project`,
			icons: [manifestIcon(product.id, 192, 'any')],
		},
	];
}

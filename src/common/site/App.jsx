import { Suspense, useState } from 'react';

import { bundledSiteCopyForLocale } from '../i18n/site-copy.js';
import { productHref } from '../product-web-links.js';
import { lazyEditorModule } from '../offline/lazy-module.tsx';
import BrandSidebar from './BrandSidebar.jsx';
import StaleBuildDialog from './StaleBuildDialog.jsx';
import { applyDocumentTheme } from './document-theme.js';
import { useSiteCopy } from './use-site-copy.js';
import './site.css';

// Vite replaces this value with a literal before Rolldown constructs the module
// graph. The unselected branch is therefore absent from the production bundle,
// rather than becoming a dormant bootstrap for a product this origin cannot
// serve. The final bundle assertion in startup-graph-budget.mjs enforces that
// output property for both product builds.
const EditorBootstrap = __SCAPE_PRODUCT__ === 'framescaper'
	? lazyEditorModule(() => import('../../framescaper/ui/FramescaperAudioEditorBootstrap.tsx'))
	: lazyEditorModule(() => import('../../soundscaper/ui/SoundscaperAudioEditorBootstrap.tsx'));
const PrivacyPolicyRoute = lazyEditorModule(() => import('../editor/ui/PrivacyPolicyRoute.tsx'));

export default function App({ route }) {
	const { desktop, direction, embedded, locale, productId } = route;
	const copy = useSiteCopy(locale);
	// The introduction starts folded at every width: a visitor came for the
	// editor, and the heading above it says which one this is without spending
	// the fold on prose they can open when they want it.
	const [introExpanded, setIntroExpanded] = useState(false);
	const intro = productId === 'framescaper' ? {
		eyebrow: copy.framescaperEyebrow,
		title: copy.framescaperTitle,
		intro: copy.framescaperIntro,
	} : copy;
	if (route.privacyPolicy) {
		return <>
			<Suspense fallback={<div role="status" aria-live="polite">{copy.loading}</div>}>
				<PrivacyPolicyRoute
					locale={locale}
					copy={copy}
					onClose={() => window.location.assign(productHref(productId, locale))}
				/>
			</Suspense>
			<StaleBuildDialog copy={copy} />
		</>;
	}

	return (
		<div className={`site-shell${embedded ? ' embedded' : ''}${desktop ? ' desktop' : ''}`}>
			{!embedded && <BrandSidebar locale={locale} productId={productId} />}
			<main>
				<section className="tool-intro" data-expanded={introExpanded ? 'true' : 'false'}>
					<div className="container">
						<div className="tool-intro-heading">
							<div>
								<p className="eyebrow">{intro.eyebrow}</p>
								<h1>{intro.title}</h1>
							</div>
							<button
								type="button"
								className="tool-intro-toggle"
								aria-expanded={introExpanded}
								aria-controls="tool-intro-body"
								onClick={() => setIntroExpanded((expanded) => !expanded)}
							>
								{introExpanded ? copy.introCollapse : copy.introExpand}
							</button>
						</div>
						<div id="tool-intro-body" className="tool-intro-body">
							<p className="tool-lede">{intro.intro}</p>
							{copy.privacy && <p className="tool-note">{copy.privacy}</p>}
						</div>
					</div>
				</section>
				<section className="section audio-editor-section tool-workspace">
					<div className="container audio-editor-container">
						<Suspense fallback={<div role="status" aria-live="polite">{copy.loading}</div>}>
							<EditorBootstrap
								locale={locale}
								fallbackCopy={copy}
								productId={productId}
								initialSurface={route.initialSurface}
							/>
						</Suspense>
					</div>
				</section>
			</main>
			<StaleBuildDialog copy={copy} />
		</div>
	);
}

export function applyDocumentRoute(route) {
	const root = document.documentElement;
	// A document generated for this locale already labels its progress bar,
	// machine translation included; only a template served for another locale
	// (the development server, the origin root) needs the bundled label.
	if (root.lang !== route.locale) {
		document.querySelector('[data-initial-load-progress]')?.setAttribute(
			'aria-label', bundledSiteCopyForLocale(route.locale).loading,
		);
	}
	root.lang = route.locale;
	root.dir = route.direction;
	root.dataset.product = route.productId;
	if (route.embedded) root.dataset.embedded = 'true';
	else delete root.dataset.embedded;
	if (route.desktop) root.dataset.desktop = 'true';
	else delete root.dataset.desktop;
	applyDocumentTheme(root, route.productId);
	updateProductHead(route.productId, route.privacyPolicy);
}

function updateProductHead(productId, privacyPolicy) {
	const productName = productId === 'framescaper' ? 'Framescaper' : 'Soundscaper';
	document.title = privacyPolicy
		? `${bundledSiteCopyForLocale(document.documentElement.lang).legalLink} · ${productName}`
		: productName;
	updateSingleProductLink('link[data-product-manifest]', {
		rel: 'manifest',
		href: `/manifest-${productId}.webmanifest`,
		'data-product-manifest': '',
	});
	updateSingleProductLink('link[data-product-install-icon]', {
		rel: 'apple-touch-icon',
		sizes: '180x180',
		href: `/offline-icons/${productId}-180.png`,
		'data-product-install-icon': '',
	});
	// iOS names a home-screen launch after this meta rather than after the
	// manifest, which it does not read, so a document served as one product and
	// booted as the other would install under the other product's name. It is
	// the only per-product tag among the install metas: the theme colours and
	// the Apple capability tags say the same thing for both products and are
	// deliberately left alone.
	updateSingleProductMeta('meta[data-product-install-title]', {
		name: 'apple-mobile-web-app-title',
		content: productName,
		'data-product-install-title': '',
	});
	const icons = productId === 'framescaper'
		? [{ href: '/logo/framescaper-icon.svg' }]
		: [
			{ href: '/logo/logo-klein-schwarz.svg', media: '(prefers-color-scheme: light)' },
			{ href: '/logo/logo-klein-weiß.svg', media: '(prefers-color-scheme: dark)' },
		];
	const existing = [...document.querySelectorAll('link[data-product-icon]')];
	const matches = existing.length === icons.length && icons.every((icon, index) => (
		existing[index].getAttribute('href') === icon.href
			&& (existing[index].getAttribute('media') || '') === (icon.media || '')
	));
	if (!matches) {
		for (const link of existing) link.remove();
		for (const icon of icons) {
			const link = document.createElement('link');
			link.rel = 'icon';
			link.type = 'image/svg+xml';
			link.href = icon.href;
			link.dataset.productIcon = '';
			if (icon.media) link.media = icon.media;
			document.head.append(link);
		}
	}
}

function updateSingleProductLink(selector, attributes) {
	updateSingleProductTag('link', selector, attributes);
}

function updateSingleProductMeta(selector, attributes) {
	updateSingleProductTag('meta', selector, attributes);
}

/**
 * Create or correct the one head tag a `data-` selector names.
 *
 * The selector is what the generated document marks its own tag with, so a
 * document served for one product is corrected in place rather than gaining a
 * second tag beside the one it arrived with; any duplicate a document does
 * carry is dropped, because a browser reading two of these reads the first.
 */
function updateSingleProductTag(tagName, selector, attributes) {
	const existing = [...document.querySelectorAll(selector)];
	const element = existing.shift() || document.createElement(tagName);
	for (const duplicate of existing) duplicate.remove();
	for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
	if (!element.isConnected) document.head.append(element);
}

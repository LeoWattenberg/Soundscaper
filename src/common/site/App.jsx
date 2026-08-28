import { lazy, Suspense } from 'react';

import { bundledSiteCopyForLocale } from '../i18n/site-copy.js';
import BrandSidebar from './BrandSidebar.jsx';
import './site.css';

const SoundscaperAudioEditorBootstrap = lazy(() => import('../../soundscaper/ui/SoundscaperAudioEditorBootstrap.tsx'));
const FramescaperAudioEditorBootstrap = lazy(() => import('../../framescaper/ui/FramescaperAudioEditorBootstrap.tsx'));

export default function App({ route }) {
	const { desktop, direction, embedded, locale, productId } = route;
	const copy = bundledSiteCopyForLocale(locale);
	const EditorBootstrap = productId !== 'framescaper'
		? SoundscaperAudioEditorBootstrap
		: FramescaperAudioEditorBootstrap;
	const intro = productId === 'framescaper' ? {
		eyebrow: copy.framescaperEyebrow,
		title: copy.framescaperTitle,
		intro: copy.framescaperIntro,
	} : copy;

	return (
		<div className={`site-shell${embedded ? ' embedded' : ''}${desktop ? ' desktop' : ''}`}>
			{!embedded && <BrandSidebar locale={locale} productId={productId} />}
			<main>
				<section className="tool-intro">
					<div className="container">
						<p className="eyebrow">{intro.eyebrow}</p>
						<h1>{intro.title}</h1>
						<p className="tool-lede">{intro.intro}</p>
						{copy.privacy && <p className="tool-note">{copy.privacy}</p>}
					</div>
				</section>
				<section className="section audio-editor-section tool-workspace">
					<div className="container audio-editor-container">
						<Suspense fallback={<div role="status" aria-live="polite">{copy.loading}</div>}>
							<EditorBootstrap locale={locale} fallbackCopy={copy} productId={productId} />
						</Suspense>
					</div>
				</section>
			</main>
		</div>
	);
}

export function applyDocumentRoute(route) {
	const root = document.documentElement;
	root.lang = route.locale;
	root.dir = route.direction;
	root.dataset.product = route.productId;
	if (route.embedded) root.dataset.embedded = 'true';
	else delete root.dataset.embedded;
	if (route.desktop) root.dataset.desktop = 'true';
	else delete root.dataset.desktop;
	try {
		localStorage.setItem('scape_last_active_product', route.productId);
		const stored = localStorage.getItem(`${route.productId}_theme`) || localStorage.getItem('soundscaper_theme');
		const theme = stored === 'light' || stored === 'dark'
			? stored
			: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
		root.dataset.theme = theme;
		root.style.colorScheme = theme;
	} catch {}
	updateProductHead(route.productId);
}

function updateProductHead(productId) {
	document.title = productId === 'framescaper' ? 'Framescaper' : 'Soundscaper';
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
	const existing = [...document.querySelectorAll(selector)];
	const link = existing.shift() || document.createElement('link');
	for (const duplicate of existing) duplicate.remove();
	for (const [name, value] of Object.entries(attributes)) link.setAttribute(name, value);
	if (!link.isConnected) document.head.append(link);
}

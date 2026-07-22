import { bundledCopyForLocale } from '../i18n/catalogs.js';
import AudioEditorBootstrap from '../editor/ui/AudioEditorBootstrap.jsx';
import BrandSidebar from './BrandSidebar.jsx';
import './site.css';

export default function App({ route }) {
	const { direction, embedded, locale, productId } = route;
	const copy = bundledCopyForLocale(locale);
	const intro = productId === 'framescaper' ? {
		eyebrow: copy.framescaperEyebrow,
		title: copy.framescaperTitle,
		intro: copy.framescaperIntro,
	} : copy;

	return (
		<div className={`site-shell${embedded ? ' embedded' : ''}`}>
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
						<AudioEditorBootstrap locale={locale} fallbackCopy={copy} productId={productId} />
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
	for (const link of document.querySelectorAll('link[data-product-icon]')) link.remove();
	const icons = productId === 'framescaper'
		? [{ href: '/logo/framescaper-icon.svg' }]
		: [
			{ href: '/logo/logo-klein-schwarz.svg', media: '(prefers-color-scheme: light)' },
			{ href: '/logo/logo-klein-weiß.svg', media: '(prefers-color-scheme: dark)' },
		];
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

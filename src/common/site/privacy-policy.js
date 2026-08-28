/* SPDX-License-Identifier: AGPL-3.0-only */

import { productProfile } from '../products.js';
import { privacyPolicyLocale, privacyPolicyPath, privacyPolicyUrl } from './privacy-policy-links.js';

export { privacyPolicyLocale, privacyPolicyPath, privacyPolicyUrl };

const EFFECTIVE_DATE = Object.freeze({ en: '28 August 2026', de: '28. August 2026' });
const CONTROLLER = 'Koytek Wattenberg Media UG (haftungsbeschränkt)';
const ADDRESS = 'Spiekerskamp 26, 45772 Marl, Germany';
const CONTACT = 'privacy@support.soundscaper.org';

const POLICY = Object.freeze({
	en: Object.freeze({
		title: 'Privacy Policy',
		languageName: 'Deutsch',
		summary: 'Soundscaper and Framescaper are local-first media editors. Your projects and media normally stay on your device. This policy explains the limited situations in which technical data is sent over a network.',
		sections: Object.freeze([
			section('overview', '1. Scope and overview', `
				<p>This policy covers Soundscaper and Framescaper, including their web applications, directly distributed Electron desktop applications, documentation, translations, runtime assets, and optional local-assistance features. It does not cover future app-store distributions.</p>
				<p>There are no accounts and no project synchronization. We use no advertising, no product analytics, no profiling, and no automated decision-making that produces legal or similarly significant effects. We do not sell personal data.</p>`),
			section('controller', '2. Controller and contact', `
				<p>The controller is <strong>${CONTROLLER}</strong>, ${ADDRESS}.</p>
				<p>For privacy questions and requests, email <a href="mailto:${CONTACT}">${CONTACT}</a>. Messages are delivered through our configured email provider, Migadu.</p>`),
			section('local-data', '3. Data kept on your device', `
				<p>Projects, imported media, recordings, capture recovery data, working files, waveform and proxy derivatives, preferences, local model artifacts, and Web VCR browser profiles are stored on your device. Media processing and local-assistance inference run on your device. We cannot access these local files.</p>
				<p>Web storage can include the origin-private file system, IndexedDB, and localStorage. Desktop applications use their local application-data area and user-selected files. The Web VCR keeps its browsing profile, including third-party cookies and login state, separate from editor projects.</p>`),
			section('permissions', '4. Device permissions and recording', `
				<p>User-initiated recording features may ask the browser or operating system for microphone, camera, display, tab audio, or system-audio access. Device labels and identifiers are requested only after a permissioned preview and are held only for the live session. Opening a project does not open a device, and devices are not reopened automatically after reload or recovery.</p>
				<p>You control these permissions in your browser and operating-system settings. You are responsible for having any permission required to record people, communications, media, or third-party services.</p>`),
			section('network', '5. When network connections occur', `
				<ul>
					<li><strong>Cloudflare delivery:</strong> Cloudflare serves the applications, documentation, translations, local-model files, and versioned runtime assets. Requests necessarily expose technical access data to Cloudflare.</li>
					<li><strong>Desktop update checks:</strong> desktop applications check the public Soundscaper releases API at GitHub no more than once per 24 hours by default. You can disable automatic update checks in settings or initiate a manual check.</li>
					<li><strong>Selected downloads:</strong> if you choose a model, package-manager installation, external FFmpeg tool, or other external component, your device connects to the named host or package source.</li>
					<li><strong>Web VCR:</strong> when you deliberately open this Framescaper feature, the selected remote site receives the URL, navigation, authentication, cookies, and interactions that you send to it. The remote site applies its own privacy policy.</li>
					<li><strong>External links and email:</strong> opening a third-party link or contacting us connects you to that provider.</li>
				</ul>
				<p><strong>Local assistance:</strong> your media never leaves your device. Only the model and runtime artifacts you select are downloaded.</p>`),
			section('logs', '6. Delivery data and logs', `
				<p>Cloudflare may transiently process an IP address, date and time, requested host and URL, HTTP method and status, referrer, browser or application user agent, approximate network/location information, and security signals to deliver and protect the services.</p>
				<p>Cloudflare HTTP log retention is disabled for our account. We do not configure Logpush or Cloudflare Web Analytics and do not retain operator-accessible raw request logs. Cloudflare may retain information for its own security and service obligations under its privacy policy. Before enabling retained logging or analytics, we will review the lawful basis and consent requirements and update this policy.</p>`),
			section('lawful-bases', '7. Purposes and lawful bases', `
				<p>Where the GDPR applies, necessary delivery and security processing is based on our legitimate interests in providing a reliable, secure local-first service (Article 6(1)(f) GDPR). Responding to messages or rights requests is based on steps requested before or during a contractual relationship (Article 6(1)(b)), compliance with legal duties (Article 6(1)(c)), or our legitimate interest in answering correspondence (Article 6(1)(f)), depending on the request.</p>
				<p>Browser or operating-system device permission controls whether software can access a device; it is not described here as consent to operator processing because captured content is not sent to us.</p>`),
			section('recipients', '8. Recipients and third-party services', `
				<p>Technical data may be processed by Cloudflare as our hosting, content-delivery, asset-storage, and security provider; by Migadu when you email us; and by GitHub during desktop update checks or when you use repository links. User-selected model hosts, package managers, external-tool sources, and Web VCR sites receive data only when you initiate those connections.</p>
				<p>Those independent services may also process data for their own purposes under their own privacy notices. We disclose information to authorities or professional advisers only where legally required or necessary to establish, exercise, or defend legal claims.</p>`),
			section('retention-deletion', '9. Retention and deletion', `
				<p>We do not receive or retain your local project and media data. Delete projects and models with the product controls. Use the Web VCR clear-data action to remove its isolated cookies, cache, and site storage. Clearing browser site data removes the web project library; deleting desktop application data removes its local library. Uninstalling a desktop build is designed to preserve its library, so uninstalling alone is not a deletion method.</p>
				<p>Capture intermediates are removed after verified publication; interrupted captures may remain as an explicit recovery session until you recover, import, or discard them. Project exports and backups outside the application must be deleted separately.</p>
				<p>Privacy correspondence is kept only until it is resolved, unless contractual, statutory, security, or legal-claims obligations require longer retention.</p>`),
			section('security', '10. Security', `
				<p>We use transport encryption, restrictive browser security headers, isolated desktop bridges, integrity checks for downloaded runtime and model artifacts, and local storage boundaries appropriate to the feature. No system is completely secure. Protect your device and backups, install trusted updates, and use device encryption where appropriate.</p>`),
			section('rights', '11. Your rights', `
				<p>Subject to applicable law, you may request access, correction, deletion, restriction, or portability of personal data we process, and object to processing based on legitimate interests. You may withdraw consent for future processing where processing is based on consent. Contact us at <a href="mailto:${CONTACT}">${CONTACT}</a>.</p>
				<p>Because we cannot access locally stored projects or media, we cannot retrieve, correct, or delete those files for you. You may lodge a complaint with a competent supervisory authority. Our German lead authority is the State Commissioner for Data Protection and Freedom of Information North Rhine-Westphalia (LDI NRW).</p>`),
			section('international-transfers', '12. International transfers', `
				<p>Cloudflare, GitHub, Migadu, and user-selected services may process data outside Germany or the European Economic Area. Where required, transfers are protected through an adequacy decision, approved contractual safeguards such as Standard Contractual Clauses, or another lawful transfer mechanism. Consult each provider’s privacy notice for its current locations and safeguards.</p>`),
			section('changes', '13. Changes to this policy', `
				<p>We will update this policy when the products, service providers, data practices, or legal requirements materially change. The current version and effective date are published on this page. Material changes will be highlighted where appropriate.</p>`),
		]),
	}),
	de: Object.freeze({
		title: 'Datenschutzerklärung',
		languageName: 'English',
		summary: 'Soundscaper und Framescaper sind lokal ausgerichtete Medieneditoren. Projekte und Medien bleiben grundsätzlich auf Ihrem Gerät. Diese Erklärung beschreibt die wenigen Fälle, in denen technische Daten über ein Netzwerk übertragen werden.',
		sections: Object.freeze([
			section('overview', '1. Geltungsbereich und Überblick', `
				<p>Diese Erklärung gilt für Soundscaper und Framescaper einschließlich der Webanwendungen, der direkt vertriebenen Electron-Desktopanwendungen, der Dokumentation, Übersetzungen, Laufzeitdateien und optionalen lokalen Assistenzfunktionen. Zukünftige App-Store-Veröffentlichungen sind nicht umfasst.</p>
				<p>Die Produkte benötigen keine Konten und bieten keine Projektsynchronisierung. Wir verwenden keine Werbung, keine Produktanalyse, kein Profiling und keine automatisierten Entscheidungen mit rechtlicher oder ähnlich erheblicher Wirkung. Wir verkaufen keine personenbezogenen Daten.</p>`),
			section('controller', '2. Verantwortlicher und Kontakt', `
				<p>Verantwortlicher ist die <strong>${CONTROLLER}</strong>, Spiekerskamp 26, 45772 Marl, Deutschland.</p>
				<p>Für Datenschutzfragen und -anfragen schreiben Sie an <a href="mailto:${CONTACT}">${CONTACT}</a>. Nachrichten werden über unseren konfigurierten E-Mail-Anbieter Migadu zugestellt.</p>`),
			section('local-data', '3. Daten auf Ihrem Gerät', `
				<p>Projekte, importierte Medien, Aufnahmen, Wiederherstellungsdaten, Arbeitsdateien, Wellenform- und Proxy-Ableitungen, Einstellungen, lokale Modellartefakte und Web-VCR-Browserprofile werden auf Ihrem Gerät gespeichert. Medienverarbeitung und lokale Assistenz laufen auf Ihrem Gerät. Wir können auf diese lokalen Dateien nicht zugreifen.</p>
				<p>Der Webspeicher kann das Origin Private File System, IndexedDB und localStorage umfassen. Desktopanwendungen verwenden ihren lokalen Anwendungsdatenbereich und von Ihnen gewählte Dateien. Web VCR hält sein Browserprofil einschließlich Cookies und Anmeldestatus von Drittseiten getrennt von Editorprojekten.</p>`),
			section('permissions', '4. Geräteberechtigungen und Aufnahmen', `
				<p>Von Ihnen gestartete Aufnahmefunktionen können den Browser oder das Betriebssystem um Zugriff auf Mikrofon, Kamera, Bildschirm, Tab-Audio oder Systemaudio bitten. Gerätebezeichnungen und Kennungen werden erst nach einer erlaubten Vorschau abgefragt und nur für die laufende Sitzung gehalten. Das Öffnen eines Projekts öffnet kein Gerät; Geräte werden nach Neuladen oder Wiederherstellung nicht automatisch erneut geöffnet.</p>
				<p>Sie verwalten diese Berechtigungen in Ihrem Browser und Betriebssystem. Sie sind dafür verantwortlich, die erforderliche Erlaubnis für Aufnahmen von Personen, Kommunikation, Medien oder Drittanbieterdiensten zu besitzen.</p>`),
			section('network', '5. Netzwerkverbindungen', `
				<ul>
					<li><strong>Bereitstellung durch Cloudflare:</strong> Cloudflare liefert Anwendungen, Dokumentation, Übersetzungen, lokale Modelldateien und versionierte Laufzeitdateien aus. Dabei erhält Cloudflare zwangsläufig technische Zugriffsdaten.</li>
					<li><strong>Desktop-Updateprüfungen:</strong> Desktopanwendungen prüfen standardmäßig höchstens einmal in 24 Stunden die öffentliche Soundscaper-Release-API bei GitHub. Automatische Prüfungen können in den Einstellungen deaktiviert oder manuell ausgelöst werden.</li>
					<li><strong>Ausgewählte Downloads:</strong> Wenn Sie ein Modell, eine Paketmanager-Installation, ein externes FFmpeg-Werkzeug oder eine andere externe Komponente wählen, verbindet sich Ihr Gerät mit dem genannten Host oder der Paketquelle.</li>
					<li><strong>Web VCR:</strong> Wenn Sie diese Framescaper-Funktion bewusst öffnen, erhält die ausgewählte Drittseite die URL, Navigation, Anmeldung, Cookies und Interaktionen, die Sie an sie senden. Es gilt die Datenschutzerklärung der Drittseite.</li>
					<li><strong>Externe Links und E-Mail:</strong> Beim Öffnen eines Drittanbieterlinks oder bei einer Kontaktaufnahme wird eine Verbindung zum jeweiligen Anbieter hergestellt.</li>
				</ul>
				<p><strong>Lokale Assistenz:</strong> Ihre Medien verlassen Ihr Gerät nicht. Nur die von Ihnen gewählten Modell- und Laufzeitdateien werden heruntergeladen.</p>`),
			section('logs', '6. Bereitstellungsdaten und Protokolle', `
				<p>Cloudflare kann vorübergehend IP-Adresse, Datum und Uhrzeit, angefragten Host und URL, HTTP-Methode und -Status, Referrer, Browser- oder Anwendungskennung, ungefähre Netzwerk-/Standortinformationen und Sicherheitssignale verarbeiten, um die Dienste auszuliefern und zu schützen.</p>
				<p>Die HTTP-Log-Aufbewahrung ist deaktiviert. Wir konfigurieren für unser Cloudflare-Konto weder Logpush noch Cloudflare Web Analytics und bewahren keine für uns zugänglichen Rohdaten von Anfragen auf. Cloudflare kann Informationen für eigene Sicherheits- und Dienstpflichten nach seiner Datenschutzerklärung speichern. Vor der Aktivierung gespeicherter Protokolle oder von Analysen prüfen wir Rechtsgrundlage und Einwilligungserfordernisse und aktualisieren diese Erklärung.</p>`),
			section('lawful-bases', '7. Zwecke und Rechtsgrundlagen', `
				<p>Soweit die DSGVO gilt, beruht die notwendige Bereitstellungs- und Sicherheitsverarbeitung auf unserem berechtigten Interesse an einem zuverlässigen und sicheren lokal ausgerichteten Dienst (Art. 6 Abs. 1 lit. f DSGVO). Die Bearbeitung von Nachrichten oder Betroffenenanfragen beruht je nach Anfrage auf vorvertraglichen oder vertraglichen Maßnahmen (Art. 6 Abs. 1 lit. b), einer rechtlichen Verpflichtung (Art. 6 Abs. 1 lit. c) oder unserem berechtigten Interesse an der Beantwortung von Korrespondenz (Art. 6 Abs. 1 lit. f).</p>
				<p>Eine Geräteberechtigung des Browsers oder Betriebssystems steuert den Softwarezugriff auf ein Gerät. Sie wird hier nicht als Einwilligung in eine Verarbeitung durch uns bezeichnet, weil aufgenommene Inhalte nicht an uns gesendet werden.</p>`),
			section('recipients', '8. Empfänger und Drittanbieter', `
				<p>Technische Daten können durch Cloudflare als Anbieter für Hosting, Inhaltsauslieferung, Dateispeicherung und Sicherheit, durch Migadu bei E-Mails an uns und durch GitHub bei Desktop-Updateprüfungen oder Repositorylinks verarbeitet werden. Von Ihnen gewählte Modellhosts, Paketmanager, Quellen externer Werkzeuge und Web-VCR-Seiten erhalten Daten nur, wenn Sie diese Verbindungen auslösen.</p>
				<p>Diese unabhängigen Dienste können Daten nach ihren eigenen Datenschutzhinweisen auch für eigene Zwecke verarbeiten. Gegenüber Behörden oder professionellen Beratern legen wir Informationen nur offen, wenn dies gesetzlich vorgeschrieben oder zur Geltendmachung, Ausübung oder Verteidigung von Rechtsansprüchen erforderlich ist.</p>`),
			section('retention-deletion', '9. Speicherdauer und Löschung', `
				<p>Wir erhalten und speichern Ihre lokalen Projekt- und Mediendaten nicht. Löschen Sie Projekte und Modelle über die Produktfunktionen. Mit der Daten-löschen-Funktion von Web VCR entfernen Sie dessen isolierte Cookies, Cache- und Websitedaten. Das Löschen von Browser-Websitedaten entfernt die Web-Projektbibliothek; das Löschen der Desktop-Anwendungsdaten entfernt deren lokale Bibliothek. Eine Deinstallation soll die Desktopbibliothek erhalten und ist daher allein keine Löschmethode.</p>
				<p>Aufnahme-Zwischendaten werden nach bestätigter Veröffentlichung entfernt. Unterbrochene Aufnahmen können als ausdrückliche Wiederherstellungssitzung verbleiben, bis Sie sie wiederherstellen, importieren oder verwerfen. Exporte und Sicherungskopien außerhalb der Anwendung müssen separat gelöscht werden.</p>
				<p>Datenschutzkorrespondenz wird nur bis zur abschließenden Bearbeitung gespeichert, soweit keine vertraglichen, gesetzlichen, Sicherheits- oder Rechtsverteidigungspflichten eine längere Speicherung erfordern.</p>`),
			section('security', '10. Sicherheit', `
				<p>Wir verwenden Transportverschlüsselung, restriktive Browser-Sicherheitsheader, isolierte Desktop-Schnittstellen, Integritätsprüfungen für heruntergeladene Laufzeit- und Modellartefakte sowie funktionsgerechte lokale Speichergrenzen. Kein System ist vollständig sicher. Schützen Sie Ihr Gerät und Ihre Sicherungen, installieren Sie vertrauenswürdige Aktualisierungen und verwenden Sie gegebenenfalls Geräteverschlüsselung.</p>`),
			section('rights', '11. Ihre Rechte', `
				<p>Nach Maßgabe des anwendbaren Rechts können Sie Auskunft, Berichtigung, Löschung, Einschränkung oder Übertragbarkeit der von uns verarbeiteten personenbezogenen Daten verlangen und einer Verarbeitung aufgrund berechtigter Interessen widersprechen. Soweit eine Verarbeitung auf Einwilligung beruht, können Sie diese mit Wirkung für die Zukunft widerrufen. Kontaktieren Sie <a href="mailto:${CONTACT}">${CONTACT}</a>.</p>
				<p>Da wir nicht auf lokal gespeicherte Projekte oder Medien zugreifen können, können wir diese Dateien nicht für Sie abrufen, berichtigen oder löschen. Sie können sich bei einer zuständigen Aufsichtsbehörde beschweren. Unsere deutsche federführende Behörde ist die Landesbeauftragte für Datenschutz und Informationsfreiheit Nordrhein-Westfalen (LDI NRW).</p>`),
			section('international-transfers', '12. Internationale Übermittlungen', `
				<p>Cloudflare, GitHub, Migadu und von Ihnen gewählte Dienste können Daten außerhalb Deutschlands oder des Europäischen Wirtschaftsraums verarbeiten. Soweit erforderlich, werden Übermittlungen durch einen Angemessenheitsbeschluss, genehmigte vertragliche Garantien wie Standardvertragsklauseln oder einen anderen zulässigen Übermittlungsmechanismus geschützt. Aktuelle Verarbeitungsorte und Garantien entnehmen Sie der Datenschutzerklärung des jeweiligen Anbieters.</p>`),
			section('changes', '13. Änderungen dieser Erklärung', `
				<p>Wir aktualisieren diese Erklärung, wenn sich Produkte, Dienstleister, Datenpraktiken oder rechtliche Anforderungen wesentlich ändern. Die aktuelle Fassung und ihr Gültigkeitsdatum werden auf dieser Seite veröffentlicht. Auf wesentliche Änderungen weisen wir gegebenenfalls besonders hin.</p>`),
		]),
	}),
});

export function renderPrivacyPolicyDocument({ productId, locale = 'en', canonicalOrigin }) {
	const policyLocale = privacyPolicyLocale(locale);
	const copy = POLICY[policyLocale];
	const productName = productProfile(productId).name;
	const origin = admittedOrigin(canonicalOrigin);
	const canonical = new URL(privacyPolicyPath(policyLocale), origin).href;
	const alternateLocale = policyLocale === 'de' ? 'en' : 'de';
	const alternate = new URL(privacyPolicyPath(alternateLocale), origin).href;
	const direction = 'ltr';
	return `<!doctype html>
<html lang="${policyLocale}" dir="${direction}" data-product="${productId}">
	<head>
		<meta charset="UTF-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<meta name="description" content="${escapeHtml(copy.summary)}" />
		<meta name="robots" content="index,follow" />
		<title>${escapeHtml(copy.title)} · ${escapeHtml(productName)}</title>
		<link rel="canonical" href="${escapeHtml(canonical)}" />
		<link rel="alternate" hreflang="${alternateLocale}" href="${escapeHtml(alternate)}" />
		<link rel="alternate" hreflang="${policyLocale}" href="${escapeHtml(canonical)}" />
		<link rel="alternate" hreflang="x-default" href="${escapeHtml(new URL(privacyPolicyPath('en'), origin).href)}" />
		<style>${policyStyles()}</style>
	</head>
	<body>
		<header><a class="product" href="/${policyLocale}/">${escapeHtml(productName)}</a><a class="language" href="${escapeHtml(alternate)}" hreflang="${alternateLocale}">${copy.languageName}</a></header>
		<main>
			<p class="eyebrow">${escapeHtml(productName)}</p>
			<h1>${copy.title}</h1>
			<p class="effective"><strong>${policyLocale === 'de' ? 'Gültig ab' : 'Effective'}:</strong> ${EFFECTIVE_DATE[policyLocale]}</p>
			<p class="summary">${copy.summary}</p>
			${copy.sections.map(({ id, heading, body }) => `<section id="${id}"><h2>${heading}</h2>${body}</section>`).join('\n\t\t\t')}
		</main>
		<footer><p>© 2026 ${CONTROLLER}</p></footer>
	</body>
</html>\n`;
}

function section(id, heading, body) {
	return Object.freeze({ id, heading, body: body.trim() });
}

function admittedOrigin(value) {
	const origin = new URL(value);
	if (!['http:', 'https:'].includes(origin.protocol) || origin.pathname !== '/' || origin.search || origin.hash) {
		throw new RangeError('Privacy policy canonical origin must be an HTTP(S) origin.');
	}
	return origin;
}

function escapeHtml(value) {
	return String(value)
		.replaceAll('&', '&amp;')
		.replaceAll('"', '&quot;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;');
}

function policyStyles() {
	return `
			:root { color-scheme: light dark; font-family: system-ui, sans-serif; line-height: 1.6; }
			body { margin: 0; background: #f7f7f5; color: #191919; }
			header, main, footer { box-sizing: border-box; margin: auto; max-width: 52rem; padding: 1.25rem; }
			header { display: flex; justify-content: space-between; border-bottom: 1px solid #ccc; }
			a { color: #2456a6; }
			.product { color: inherit; font-weight: 700; text-decoration: none; }
			h1 { font-size: clamp(2rem, 6vw, 3.5rem); line-height: 1.1; margin: 0 0 1rem; }
			h2 { font-size: 1.35rem; margin-top: 2.5rem; }
			.eyebrow, .effective { color: #595959; }
			.eyebrow { font-weight: 700; margin-bottom: .5rem; text-transform: uppercase; }
			.summary { font-size: 1.15rem; }
			li + li { margin-top: .65rem; }
			footer { border-top: 1px solid #ccc; color: #595959; font-size: .9rem; }
			@media (prefers-color-scheme: dark) { body { background: #151515; color: #f5f5f5; } header, footer { border-color: #444; } a { color: #8ab4ff; } .eyebrow, .effective, footer { color: #bbb; } }
		`;
}

// Charge par AppAPI dans la page Nextcloud /index.php/apps/app_api/embedded/__APP_ID__/main/...
// Affiche le portail en iframe plein ecran, servi par HaRP sous /exapps/__APP_ID__/ :
// meme origine que Nextcloud, donc ni CORS ni cookie tiers.
(function () {
	const APP_ID = '__APP_ID__'
	const webroot = (window.OC && window.OC.webroot) || ''
	const base = `${webroot}/exapps/${APP_ID}`

	// Lien direct : /embedded/<id>/main/cameras/3 -> /exapps/<id>/cameras/3
	const marker = `/embedded/${APP_ID}/main`
	const idx = window.location.pathname.indexOf(marker)
	const subPath = idx >= 0 ? window.location.pathname.slice(idx + marker.length) : ''

	function mount() {
		// Nextcloud 35 : la page contient DEUX #content, le cadre de mise en page
		// (#content.app-app_api) puis, dedans, la zone reservee a l'app. getElementById
		// rendait le cadre : l'iframe se retrouvait a cote de la zone vide, qui passait
		// par-dessus et captait les clics (navigation impossible, constate sur AIO NC 35).
		const all = document.querySelectorAll('#content')
		const content = all[all.length - 1]
		if (!content || document.querySelector('iframe[data-exapp]')) return
		if (all.length > 1) {
			// La zone reservee herite du style Nextcloud de #content (position fixe, marge
			// haute) : la remettre dans le flux pour qu'elle remplisse exactement le cadre.
			content.style.cssText = 'position:relative;inset:auto;margin:0;padding:0;flex:1 1 auto;'
				+ 'width:100%;height:100%;min-height:0;display:block;'
		} else {
			content.style.height = 'calc(100vh - var(--header-height, 50px))'
		}
		const iframe = document.createElement('iframe')
		iframe.dataset.exapp = APP_ID
		iframe.src = base + (subPath || '/') + window.location.search + window.location.hash
		iframe.title = 'Budget Manager'
		// `allow` suffit pour le plein ecran ; allowFullscreen en plus declenche un avertissement.
		iframe.allow = 'clipboard-read; clipboard-write; fullscreen'
		iframe.style.cssText = 'border:0;width:100%;height:100%;display:block;'
		content.appendChild(iframe)
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', mount)
	} else {
		mount()
	}
})()

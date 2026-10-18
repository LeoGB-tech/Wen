# ⚓ Ancre

Télécharge un site entier (pages, sous-pages, images, CSS, polices, PDF) pour le lire hors ligne, sans pubs, traqueurs ni bandeaux cookies.

## Lancer

**Windows** : double-clic sur `Lancer Ancre.bat` (Node.js 20+ requis). Le navigateur s'ouvre sur http://localhost:4321.

Ailleurs : `npm install` puis `npm start`.

## Fonctionnement

- Colle une URL → Ancre suit les liens internes (profondeur et nombre de pages réglables) et réécrit chaque lien vers la copie locale.
- Les pages hors limite affichent « Cette page n'a pas été téléchargée » au lieu d'un lien cassé.
- Pubs, traqueurs, bandeaux cookies, scripts et iframes (YouTube, cartes…) retirés ; images en chargement différé récupérées.
- Recherche plein texte dans tous les sites enregistrés, lecteur avec liste des pages.
- « Mettre à jour » retélécharge un site en réutilisant les images déjà présentes.

Les sites sont rangés dans `sites/` (un dossier par site). Autre emplacement : `set ANCRE_DATA=D:\MesSites` avant de lancer. Autre port : `set PORT=5000`.

## Limites

Les sites entièrement générés en JavaScript (applis React/SPA sans rendu serveur) ou derrière une connexion peuvent s'enregistrer incomplets. L'option « Garder les scripts » aide parfois.

/// <reference types="vite/client" />

/*
 * Sans cette référence, `tsc --noEmit` échoue sur les imports de feuilles
 * de style (`import './grid.css'`) avec TS2307 : TypeScript ne connaît pas
 * l'extension .css, c'est Vite qui la gère. Le fichier déclare aussi
 * `import.meta.env` si on en a besoin plus tard.
 */

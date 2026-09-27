#!/usr/bin/env node
/**
 * Taux de change du jour — outil séparé, à exécuter à part.
 *
 * Budget Manager (budget-app.html) est volontairement hors ligne et sans
 * aucune ressource externe : c'est ce qui garantit qu'il continue de
 * fonctionner à l'identique dans dix ans, sur n'importe quel poste, sans
 * jamais rien télécharger. La conséquence directe, c'est qu'il ne peut pas
 * aller chercher un taux de change en direct depuis l'application elle-même
 * (voir l'onglet Sociétés > panneau « Taux de change », où les taux se
 * saisissent à la main).
 *
 * Ce script-ci n'a pas cette contrainte : c'est un utilitaire à part,
 * lancé volontairement par vous, avec une connexion internet, uniquement
 * pour vous éviter de chercher le taux du jour à la main sur le web. Il
 * n'est jamais appelé par budget-app.html et n'en fait pas partie.
 *
 * Utilisation :
 *   node taux-du-jour.mjs                  -> USD, GBP, CHF (par défaut)
 *   node taux-du-jour.mjs USD GBP JPY       -> devises de votre choix
 *
 * Source : l'API Frankfurter (https://frankfurter.dev), qui republie les
 * taux de référence quotidiens de la Banque centrale européenne — pas de
 * clé d'accès à créer, pas de compte, gratuit.
 *
 * Le résultat s'affiche dans le terminal dans les deux sens (1 EUR = ... et
 * 1 devise = ... EUR) : c'est cette seconde valeur, « 1 devise = X EUR »,
 * qu'il faut recopier dans le panneau « Taux de change » de l'onglet
 * Sociétés — c'est exactement ce que `toEurRate()` attend dans l'application.
 */

const DEFAULT_CURRENCIES = ['USD', 'GBP', 'CHF'];

async function main() {
  const requested = process.argv.slice(2).map((c) => c.toUpperCase());
  const currencies = requested.length ? requested : DEFAULT_CURRENCIES;

  const url = 'https://api.frankfurter.dev/v1/latest?from=EUR&to=' + currencies.join(',');
  let response;
  try {
    response = await fetch(url);
  } catch (err) {
    console.error('Impossible de contacter l’API de taux de change (pas de connexion internet ?) :', err.message);
    process.exitCode = 1;
    return;
  }
  if (!response.ok) {
    console.error('L’API a répondu avec une erreur : ' + response.status + ' ' + response.statusText);
    process.exitCode = 1;
    return;
  }
  const data = await response.json();

  console.log('Taux de change du ' + data.date + ' (source : Banque centrale européenne, via frankfurter.dev)\n');

  const toEur = {};
  for (const code of currencies) {
    const eurToCode = data.rates[code];
    if (eurToCode === undefined) {
      console.log('  ' + code + ' : devise inconnue de l’API, ignorée.');
      continue;
    }
    const codeToEur = 1 / eurToCode;
    toEur[code] = Math.round(codeToEur * 10000) / 10000;
    console.log('  1 EUR = ' + eurToCode + ' ' + code + '   |   1 ' + code + ' = ' + toEur[code] + ' EUR  <- à recopier dans Sociétés > Taux de change');
  }

  console.log('\nÀ copier tel quel dans le panneau « Taux de change » de l’onglet Sociétés :');
  console.log(JSON.stringify(toEur, null, 2));
}

main();

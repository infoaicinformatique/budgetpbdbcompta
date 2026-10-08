/* ==================================================================
   QUI A LA MAIN SUR UN BUDGET

   Alexis, 08/10/2026 : « lorsque deux personnes édite le même budget en
   même temps → indiquer à la personne qui s'est connecté la dernière que
   les modifications sont impossibles et indiquer la personne qui a la
   main ».

   Jusqu'ici les saisies simultanées se réglaient APRÈS coup : chaque
   société porte le numéro de la révision qui l'a modifiée, et la deuxième
   écriture était refusée (409, voir `data.mjs`) avec un « refaites votre
   dernière saisie ». Personne n'était prévenu AVANT de taper.

   La main se prend donc à l'arrivée, société par société : la PREMIÈRE
   personne à l'annoncer l'obtient et la garde ; les suivantes sont en
   lecture seule et savent qui l'a. Par société, et non pour la base
   entière : deux directeurs sur deux établissements différents ne se
   gênent pas, et c'est déjà la maille des conflits d'écriture.

   Elle se garde par battement de cœur (`claim`, répété par le navigateur)
   et se libère d'elle-même après `ttlMs` sans nouvelle : un onglet fermé,
   un poste éteint ou une personne partie déjeuner ne doivent pas bloquer
   le budget pour la journée. En mémoire seulement — un verrou qui
   survivrait au redémarrage du conteneur serait un verrou que personne ne
   peut plus lever.
   ================================================================== */

/** Délai sans battement au bout duquel la main est rendue. */
export const PRESENCE_TTL_MS = 70 * 1000;

/**
 * Registre des mains, une par société. `now` et `ttlMs` sont injectables
 * pour les tests (horloge simulée).
 */
export function createPresenceStore(options = {}) {
  const now = options.now || (() => Date.now());
  const ttlMs = options.ttlMs ?? PRESENCE_TTL_MS;
  /** companyId -> { account, name, since, seen } */
  const hands = new Map();

  /** Rend la main de toute entrée qui n'a plus donné de nouvelle depuis `ttlMs`. */
  function expire() {
    const limit = now() - ttlMs;
    for (const [companyId, hand] of hands) if (hand.seen <= limit) hands.delete(companyId);
  }

  function publicHand(hand) {
    return hand ? { account: hand.account, name: hand.name || hand.account, since: new Date(hand.since).toISOString() } : null;
  }

  return {
    /**
     * « Je suis sur cette société. » Rend qui a la main et si c'est moi.
     * La première personne à appeler l'obtient ; un deuxième appel de la
     * même personne ne fait que repousser l'expiration — la main ne change
     * donc pas de propriétaire tant que son détenteur donne des nouvelles.
     */
    claim(account, name, companyId) {
      expire();
      if (!account || !companyId) return { holder: null, mine: false };
      const current = hands.get(companyId);
      if (current && current.account !== account) {
        return { holder: publicHand(current), mine: false };
      }
      const since = current ? current.since : now();
      const hand = { account: account, name: name || account, since: since, seen: now() };
      hands.set(companyId, hand);
      return { holder: publicHand(hand), mine: true };
    },

    /** Qui a la main sur cette société, ou `null` si elle est libre. */
    holderOf(companyId) {
      expire();
      const hand = hands.get(companyId);
      return hand ? publicHand(hand) : null;
    },

    /**
     * Cette société est-elle tenue par QUELQU'UN D'AUTRE que `account` ?
     * C'est la question que pose l'écriture avant d'enregistrer.
     */
    heldByOther(account, companyId) {
      const hand = this.holderOf(companyId);
      return hand && hand.account !== account ? hand : null;
    },

    /**
     * Rend la main : une société précise, ou toutes celles de ce compte
     * (déconnexion, fermeture de l'onglet). Rendre la main de quelqu'un
     * d'autre est sans effet — on ne reprend pas une main de force.
     */
    release(account, companyId) {
      if (!account) return 0;
      let released = 0;
      for (const [id, hand] of [...hands]) {
        if (hand.account !== account) continue;
        if (companyId && id !== companyId) continue;
        hands.delete(id);
        released++;
      }
      return released;
    },

    /**
     * Le refus à opposer à une écriture, ou `null` si elle peut passer :
     * la première société déclarée modifiée qu'une AUTRE personne tient.
     * Rendu tel quel au navigateur (409), qui y lit de quoi nommer la
     * personne sans attendre son prochain battement.
     *
     * Vit ici et non dans le gestionnaire HTTP pour être vérifiable : la
     * phrase affichée à quelqu'un dont la saisie vient d'être refusée doit
     * nommer la bonne personne et la bonne société.
     */
    refusalFor(account, declaredCompanies, state) {
      for (const companyId of declaredCompanies || []) {
        const holder = this.heldByOther(account, companyId);
        if (!holder) continue;
        const companies = Array.isArray(state && state.companies) ? state.companies : [];
        const company = companies.find((c) => c && c.id === companyId);
        const label = company && company.name ? company.name : companyId;
        return {
          error: `« ${label} » est ouvert par ${holder.name} : c’est lui qui a la main, votre modification n’a pas été enregistrée.`,
          handHolder: holder,
          handCompany: companyId,
        };
      }
      return null;
    },

    /** Toutes les mains en cours — diagnostic et tests. */
    all() {
      expire();
      const out = {};
      for (const [companyId, hand] of hands) out[companyId] = publicHand(hand);
      return out;
    },
  };
}

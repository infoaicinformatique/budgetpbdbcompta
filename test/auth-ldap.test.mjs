// Tests de auth-ldap.mjs, sans annuaire réel : un faux client LDAP rejoue
// un petit annuaire en mémoire. Lancer : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InvalidCredentialsError } from 'ldapts';
import {
  ldapConfigFromEnv, ldapAuthenticate, escapeFilterValue, LdapUnavailableError, publicLdapInfo,
  ldapAuthenticateEntry, ldapListGroupMembers,
} from '../auth-ldap.mjs';

const PEOPLE = 'ou=people,dc=pb,dc=fr';
const ALICE = 'uid=alice,' + PEOPLE;
const SERVICE = 'cn=svc,dc=pb,dc=fr';
const GROUP = 'cn=budget,ou=groups,dc=pb,dc=fr';

/** Faux client : mots de passe par DN, membres du groupe, URL injoignables. */
function fakeDirectory(options) {
  const o = options || {};
  const passwords = o.passwords || { [ALICE]: 'secret', [SERVICE]: 'svcpass' };
  const members = o.members || [ALICE];
  const down = o.down || [];
  const log = [];
  class FakeClient {
    constructor(opts) { this.url = opts.url; this.boundAs = null; log.push(['new', opts.url, opts.tlsOptions]); }
    async startTLS() { log.push(['starttls', this.url]); }
    async bind(dn, password) {
      if (down.includes(this.url)) {
        const err = new Error('connect ECONNREFUSED'); err.code = 'ECONNREFUSED'; throw err;
      }
      log.push(['bind', this.url, dn]);
      if (!password || passwords[dn] !== password) throw new InvalidCredentialsError('bad', 49);
      this.boundAs = dn;
    }
    async search(base, opts) {
      if (down.includes(this.url)) {
        const err = new Error('connect ECONNREFUSED'); err.code = 'ECONNREFUSED'; throw err;
      }
      log.push(['search', base, opts.filter, this.boundAs]);
      if (base === GROUP) {
        const hit = members.some((m) => opts.filter.includes('(member=' + escapeFilterValue(m) + ')'));
        return { searchEntries: hit ? [{ dn: GROUP }] : [] };
      }
      const m = /\(uid=([^)]*)\)/.exec(opts.filter);
      const dns = Object.keys(passwords).filter((dn) => m && dn === 'uid=' + m[1] + ',' + PEOPLE);
      return { searchEntries: (o.extraEntries || []).concat(dns.map((dn) => ({ dn }))) };
    }
    async unbind() { log.push(['unbind', this.url]); }
  }
  return { FakeClient, log };
}

const direct = () => ldapConfigFromEnv({ LDAP_URL: 'ldap://a', LDAP_USER_DN: 'uid={username},' + PEOPLE });
const search = (extra) => ldapConfigFromEnv(Object.assign({
  LDAP_URL: 'ldap://a', LDAP_SEARCH_BASE: PEOPLE, LDAP_BIND_DN: SERVICE, LDAP_BIND_PASSWORD: 'svcpass',
}, extra));

test('LDAP désactivé sans LDAP_URL', () => {
  assert.equal(ldapConfigFromEnv({}), null);
});

test('configurations incomplètes ou contradictoires refusées', () => {
  assert.throws(() => ldapConfigFromEnv({ LDAP_URL: 'ldap://a' }), /LDAP_USER_DN/);
  assert.throws(() => ldapConfigFromEnv({ LDAP_URL: 'http://a', LDAP_USER_DN: '{username}' }), /LDAP_URL invalide/);
  assert.throws(() => ldapConfigFromEnv({ LDAP_URL: 'ldap://a', LDAP_USER_DN: 'uid=x' }), /\{username\}/);
  assert.throws(() => ldapConfigFromEnv({ LDAP_URL: 'ldap://a', LDAP_USER_DN: 'u={username}', LDAP_SEARCH_BASE: 'dc=x' }), /exclusifs/);
  assert.throws(() => ldapConfigFromEnv({ LDAP_URL: 'ldap://a', LDAP_SEARCH_BASE: 'dc=x', LDAP_BIND_DN: 'cn=s' }), /LDAP_BIND_PASSWORD/);
  assert.throws(() => ldapConfigFromEnv({ LDAP_URL: 'ldap://a', LDAP_USER_DN: '{username}@pb.local', LDAP_GROUP_DN: GROUP }), /DN complet/);
});

test('échappement des filtres (RFC 4515)', () => {
  assert.equal(escapeFilterValue('a*b(c)d\\e'), 'a\\2ab\\28c\\29d\\5ce');
});

test('bind direct : bon et mauvais mot de passe', async () => {
  const { FakeClient } = fakeDirectory();
  assert.equal(await ldapAuthenticate(direct(), 'alice', 'secret', FakeClient), ALICE);
  assert.equal(await ldapAuthenticate(direct(), 'alice', 'faux', FakeClient), null);
  assert.equal(await ldapAuthenticate(direct(), 'bob', 'secret', FakeClient), null);
});

test('mot de passe vide : jamais de bind (il serait anonyme)', async () => {
  const { FakeClient, log } = fakeDirectory();
  assert.equal(await ldapAuthenticate(direct(), 'alice', '', FakeClient), null);
  assert.equal(log.length, 0);
});

test('nom d’utilisateur hors du jeu de caractères sûr : refusé sans requête', async () => {
  const { FakeClient, log } = fakeDirectory();
  for (const name of ['*', 'alice)(uid=*', 'a,ou=x', 'a=b', '', 'x'.repeat(65)]) {
    assert.equal(await ldapAuthenticate(search(), name, 'secret', FakeClient), null, name);
  }
  assert.equal(log.length, 0);
});

test('recherche puis bind, au nom du compte de service', async () => {
  const { FakeClient, log } = fakeDirectory();
  assert.equal(await ldapAuthenticate(search(), 'alice', 'secret', FakeClient), ALICE);
  const s = log.find((e) => e[0] === 'search');
  assert.equal(s[3], SERVICE);
  assert.match(s[2], /\(uid=alice\)/);
  assert.equal(await ldapAuthenticate(search(), 'alice', 'faux', FakeClient), null);
  assert.equal(await ldapAuthenticate(search(), 'inconnu', 'secret', FakeClient), null);
});

test('recherche ambiguë (deux entrées) : refus', async () => {
  const { FakeClient } = fakeDirectory({ extraEntries: [{ dn: 'uid=alice,ou=autre,dc=pb,dc=fr' }] });
  assert.equal(await ldapAuthenticate(search(), 'alice', 'secret', FakeClient), null);
});

test('compte de service refusé : annuaire indisponible, pas un mauvais mot de passe', async () => {
  const { FakeClient } = fakeDirectory();
  const config = search({ LDAP_BIND_PASSWORD: 'mauvais' });
  await assert.rejects(ldapAuthenticate(config, 'alice', 'secret', FakeClient), LdapUnavailableError);
});

test('groupe exigé : membre accepté, non-membre refusé', async () => {
  const bob = 'uid=bob,' + PEOPLE;
  const { FakeClient } = fakeDirectory({ passwords: { [ALICE]: 'secret', [bob]: 'b', [SERVICE]: 'svcpass' } });
  const config = search({ LDAP_GROUP_DN: GROUP });
  assert.equal(await ldapAuthenticate(config, 'alice', 'secret', FakeClient), ALICE);
  assert.equal(await ldapAuthenticate(config, 'bob', 'b', FakeClient), null);
});

test('plusieurs URL : bascule sur la suivante si la première est injoignable', async () => {
  const { FakeClient } = fakeDirectory({ down: ['ldap://a'] });
  const config = ldapConfigFromEnv({ LDAP_URL: 'ldap://a, ldap://b', LDAP_USER_DN: 'uid={username},' + PEOPLE });
  assert.equal(await ldapAuthenticate(config, 'alice', 'secret', FakeClient), ALICE);
  assert.equal(await ldapAuthenticate(config, 'alice', 'faux', FakeClient), null);
});

test('bascule aussi en mode recherche (compte de service sur une URL injoignable)', async () => {
  const { FakeClient } = fakeDirectory({ down: ['ldap://a'] });
  const config = search({ LDAP_URL: 'ldap://a,ldap://b', LDAP_GROUP_DN: GROUP });
  assert.equal(await ldapAuthenticate(config, 'alice', 'secret', FakeClient), ALICE);
});

test('toutes les URL injoignables : LdapUnavailableError', async () => {
  const { FakeClient } = fakeDirectory({ down: ['ldap://a'] });
  await assert.rejects(ldapAuthenticate(direct(), 'alice', 'secret', FakeClient), LdapUnavailableError);
});

test('StartTLS demandé avant tout bind', async () => {
  const { FakeClient, log } = fakeDirectory();
  const config = ldapConfigFromEnv({ LDAP_URL: 'ldap://a', LDAP_USER_DN: 'uid={username},' + PEOPLE, LDAP_STARTTLS: 'true' });
  await ldapAuthenticate(config, 'alice', 'secret', FakeClient);
  assert.equal(log[1][0], 'starttls');
});

test('options TLS transmises au client pour ldaps:// seulement', async () => {
  // ldapts passe en TLS dès qu'il reçoit des tlsOptions : sur ldap://, la
  // connexion en clair (ou StartTLS) échouerait.
  const { FakeClient, log } = fakeDirectory({ passwords: { [ALICE]: 'secret' } });
  const config = ldapConfigFromEnv({ LDAP_URL: 'ldap://a ldaps://b', LDAP_USER_DN: 'uid={username},' + PEOPLE });
  await ldapAuthenticate(config, 'alice', 'secret', FakeClient);
  assert.equal(log.find((e) => e[0] === 'new' && e[1] === 'ldap://a')[2], undefined);
  const { FakeClient: F2, log: log2 } = fakeDirectory({ down: ['ldap://a'] });
  await ldapAuthenticate(config, 'alice', 'secret', F2);
  assert.deepEqual(log2.find((e) => e[0] === 'new' && e[1] === 'ldaps://b')[2], { rejectUnauthorized: true });
});

test('publicLdapInfo : chiffrement, mode et périmètre, jamais le compte de service', () => {
  const info = publicLdapInfo(search({ LDAP_GROUP_DN: GROUP }));
  assert.deepEqual(info, {
    urls: ['ldap://a'], encryption: 'aucun', mode: 'recherche', base: PEOPLE, group: GROUP,
  });
  assert.ok(!JSON.stringify(info).includes('svcpass') && !JSON.stringify(info).includes(SERVICE));
  assert.equal(publicLdapInfo(direct()).mode, 'direct');
  assert.equal(publicLdapInfo(direct()).base, 'uid={username},' + PEOPLE);
  const enc = (env) => publicLdapInfo(ldapConfigFromEnv(Object.assign({ LDAP_USER_DN: '{username}@pb.fr' }, env))).encryption;
  assert.equal(enc({ LDAP_URL: 'ldaps://a:636' }), 'ldaps');
  assert.equal(enc({ LDAP_URL: 'ldap://a ldaps://b' }), 'partiel');
  assert.equal(enc({ LDAP_URL: 'ldap://a', LDAP_STARTTLS: 'true' }), 'starttls');
});

/** Petit annuaire AD : entrées avec attributs, groupe avec `member`. */
function adDirectory() {
  const USER = 'CN=Prénom Nom,OU=UniversalUsers,DC=pb,DC=org';
  const OTHER = 'CN=Autre,OU=UniversalUsers,DC=pb,DC=org';
  const GRP = 'CN=budgetpbdbcompta,OU=Groupes,DC=pb,DC=org';
  const entries = {
    [USER]: { dn: USER, sAMAccountName: 'Prenom.Nom', displayName: 'Prénom Nom',
      mail: 'Prenom.Nom@pb.org', userPrincipalName: 'prenom.nom@pbcannes.org' },
    // Sans `mail` : l'annuaire de production en compte beaucoup. Le
    // userPrincipalName ne doit PAS servir de repli.
    [OTHER]: { dn: OTHER, sAMAccountName: 'autre', cn: 'Autre', userPrincipalName: 'autre@pbcannes.org' },
    [GRP]: { dn: GRP, member: [USER, OTHER, 'CN=Supprimé,DC=pb,DC=org'] },
  };
  class AdClient {
    async bind(dn, password) {
      if (!((dn === SERVICE && password === 'svcpass') || (dn === USER && password === 'secret'))) {
        throw new InvalidCredentialsError('bad', 49);
      }
    }
    async search(base, opts) {
      if (opts.scope === 'sub') {
        return { searchEntries: /Prenom\.Nom|prenom\.nom/i.test(opts.filter) ? [entries[USER]] : [] };
      }
      if (base === GRP && opts.filter.startsWith('(|')) {
        return { searchEntries: opts.filter.includes(escapeFilterValue(USER)) ? [{ dn: GRP }] : [] };
      }
      if (!entries[base]) throw new Error('No Such Object');
      return { searchEntries: [entries[base]] };
    }
    async unbind() {}
  }
  const config = ldapConfigFromEnv({
    LDAP_URL: 'ldap://dc', LDAP_SEARCH_BASE: 'OU=UniversalUsers,DC=pb,DC=org',
    LDAP_BIND_DN: SERVICE, LDAP_BIND_PASSWORD: 'svcpass', LDAP_GROUP_DN: GRP,
  });
  return { AdClient, config, USER, OTHER };
}

test('ldapAuthenticateEntry : identifiant canonique et nom affiché lus dans l’annuaire', async () => {
  const { AdClient, config, USER } = adDirectory();
  assert.deepEqual(await ldapAuthenticateEntry(config, 'prenom.nom@pb.org', 'secret', AdClient),
    { dn: USER, account: 'prenom.nom', displayName: 'Prénom Nom', mail: 'prenom.nom@pb.org' });
  assert.equal(await ldapAuthenticate(config, 'prenom.nom', 'secret', AdClient), USER, 'ldapAuthenticate rend toujours le DN');
  assert.equal(await ldapAuthenticateEntry(config, 'prenom.nom', 'faux', AdClient), null);
});

test('ldapAuthenticateEntry en bind direct : identifiant saisi sans son domaine', async () => {
  const { FakeClient } = fakeDirectory();
  const entry = await ldapAuthenticateEntry(direct(), 'alice', 'secret', FakeClient);
  assert.deepEqual(entry, { dn: ALICE, account: 'alice', displayName: '', mail: '' },
    'bind direct : aucune entrée n’est lue, donc ni nom ni adresse');
});

test('adresse de courrier : l’attribut mail seulement, jamais le userPrincipalName (04/10/2026)', async () => {
  const { AdClient, config, USER } = adDirectory();
  const entry = await ldapAuthenticateEntry(config, 'prenom.nom', 'secret', AdClient);
  assert.equal(entry.mail, 'prenom.nom@pb.org', 'l’adresse est reprise de l’annuaire, en minuscules');
  assert.equal(entry.dn, USER);
  const members = await ldapListGroupMembers(config, AdClient);
  const sansMail = members.find((m) => m.account === 'autre');
  assert.equal(sansMail.mail, '', 'sans attribut mail : adresse vide, et surtout pas l’UPN');
  assert.ok(!JSON.stringify(members).includes('pbcannes.org'), 'aucun userPrincipalName ne doit filtrer');
});

test('ldapListGroupMembers : membres du groupe, même ceux qu’on ne peut pas lire', async () => {
  const { AdClient, config, USER, OTHER } = adDirectory();
  const members = await ldapListGroupMembers(config, AdClient);
  assert.deepEqual(members, [
    { dn: OTHER, account: 'autre', displayName: 'Autre', mail: '' },
    { dn: 'CN=Supprimé,DC=pb,DC=org', account: '', displayName: '', mail: '' },
    { dn: USER, account: 'prenom.nom', displayName: 'Prénom Nom', mail: 'prenom.nom@pb.org' },
  ], 'triés par nom affiché, à défaut par identifiant puis DN');
  assert.deepEqual(await ldapListGroupMembers(search(), AdClient), [], 'sans groupe configuré : liste vide');
});

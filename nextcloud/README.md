# Budget Manager dans Nextcloud AIO (ExApp)

Budget Manager peut être servi comme **ExApp** Nextcloud (AppAPI + HaRP), sur l'instance AIO.

**Accès**
- Connexion **uniquement par Nextcloud** : pas de fenêtre d'identifiants, pas de compte local.
- Seuls les membres du groupe Nextcloud **`budgetpbdbcompta`** (`NC_ALLOWED_GROUPS`) entrent. Les autres
  voient « Accès refusé ».
- Une fois entré, chacun garde **exactement ses droits** (`droits.json`, `RIGHTS_ADMINS`, rôles). Ils se
  règlent toujours dans *Paramètres › Droits d'accès*, dont la liste « personnes de l'annuaire » reste
  alimentée par le compte de service LDAP.

**Isolation**
- Code dans l'image, données dans le volume `nc_app_budgetpbdbcompta_data`.
- Rien dans AIO, rien dans la base Nextcloud.

**Production autonome inchangée.** Sur AIServer (`docker compose`, Basic + annuaire), rien ne change : le
mode Nextcloud ne s'active que si AppAPI injecte `APP_ID` et `APP_SECRET`.

```
Navigateur ──(session Nextcloud)──> HaRP /exapps/budgetpbdbcompta/ ──> server.mjs
   nextcloud-exapp.mjs : secret AppAPI, identité + groupes (/cloud/user), porte budgetpbdbcompta
   server.mjs          : identifiant d'annuaire (LDAP, compte de service) → droits.json
```

## Prérequis

- AIO avec **HaRP** activé, *Test deploy* de `harp_aio` à 6/6. C'est déjà le cas, VisionIA y tourne.
- Groupe Nextcloud `budgetpbdbcompta`. Le vérifier :
  `docker exec --user www-data nextcloud-aio-nextcloud php occ group:list | grep -i budget`
- Le serveur AIO doit joindre l'annuaire `SRV-DC-01.pbcannes.org:636` : la liste « personnes de l'annuaire »
  et la correspondance des identifiants en dépendent.

## 1. Installation (sur le serveur AIO, en root)

```bash
cd /opt && git clone -b feat/nextcloud-exapp https://github.com/infoaicinformatique/budgetpbdbcompta.git && cd budgetpbdbcompta
bash nextcloud/install-aio.sh 2>&1 | tee /root/budgetpbdbcompta-install.log
```

Le script construit l'image `localhost:5000/budgetpbdbcompta:1.0.0`, la pousse dans le registre local (déjà
créé pour VisionIA), enregistre l'app et lance le contrôle final.

**Sans import, l'app démarre vide :**
- aucune donnée ni droits ;
- pas d'annuaire (sans `.env`), donc l'identifiant Nextcloud sert de clé aux droits ;
- `RIGHTS_ADMINS` est vide : personne n'est administrateur.

Elle est donc inutilisable tant que la configuration de production n'est pas importée (§ 2).

## 2. Reprendre la production (droits, budgets, réglages LDAP)

À faire **au moment de la bascule**. Ensuite, la version autonome ne doit plus être utilisée, sinon les deux
copies des budgets divergent.

**Sur AIServer (192.168.100.236)**, en root :
```bash
cd /opt/docker/budgetpbdbcompta
docker compose stop budgetpbdbcompta
mkdir -p /root/migration-budget && docker run --rm -v budgetpbdbcompta_droits:/data -v /root/migration-budget:/out alpine sh -c "cp -a /data/. /out/"
cp .env ldap-ca.pem /root/migration-budget/
tar czf /root/budget-migration.tar.gz -C /root/migration-budget .
```
- Le nom du volume peut différer : `docker volume ls | grep droits`.
- L'archive contient `droits.json`, `budget.json`, `historique/`, `preferences.json`, `.env` (mots de passe
  LDAP) et `ldap-ca.pem`. **Elle contient des secrets** : la transférer directement, sans la laisser traîner.

**Transfert vers le serveur AIO** (192.168.100.247), par exemple depuis AIServer :
```bash
scp /root/budget-migration.tar.gz aic@192.168.100.247:/tmp/
```

**Sur le serveur AIO**, en root :
```bash
cd /opt/budgetpbdbcompta
bash nextcloud/scripts/restore-exapp.sh budgetpbdbcompta /tmp/budget-migration.tar.gz --yes
shred -u /tmp/budget-migration.tar.gz
docker logs --tail 20 nc_app_budgetpbdbcompta
```
Le journal doit afficher l'annuaire LDAP, les administrateurs désignés et
`ExApp Nextcloud « budgetpbdbcompta » : connexion par Nextcloud uniquement`.

`start.sh` relit `/data/.env` et `/data/ldap-ca.pem` à chaque démarrage. Il impose les chemins de l'ExApp et
ignore `BASIC_AUTH_*` (pas de compte local).

## 3. Vérifier

1. Dans Nextcloud, avec un membre de `budgetpbdbcompta` : l'entrée **Budget Manager** est dans le menu.
   L'app s'ouvre sans demander de mot de passe, avec la bonne personne (Paramètres › Mon compte) et ses
   droits habituels.
2. **Cliquer dans plusieurs onglets** et vérifier que la page change. En parallèle sur le serveur :
   `docker logs -f --since 10s nc_app_budgetpbdbcompta`
3. Un administrateur ouvre Paramètres › Droits d'accès : la liste de l'annuaire s'affiche.
4. Un compte hors du groupe voit « Accès refusé ».
5. Lancer `bash nextcloud/scripts/check-exapp.sh budgetpbdbcompta` : tout doit être OK.

## 4. Sauvegarde (obligatoire)

Le volume `nc_app_budgetpbdbcompta_data` **n'est pas** dans la sauvegarde Borg d'AIO.
```bash
mkdir -p /srv/backups/budgetpbdbcompta && (crontab -l 2>/dev/null; echo "15 3 * * * /opt/budgetpbdbcompta/nextcloud/scripts/backup-exapp.sh budgetpbdbcompta /srv/backups/budgetpbdbcompta >> /var/log/budgetpbdbcompta-backup.log 2>&1") | crontab -
```
`historique/` (200 copies du budget) reste dans le volume, comme en production.

## 5. Mettre à jour

### Automatiquement (recommandé) : l'équivalent de Watchtower

Comme la production autonome, que Watchtower met à jour après chaque fusion dans `main`, la version Nextcloud
peut se mettre à jour seule. Watchtower lui-même ne convient pas : il recrée le conteneur à partir d'une image
de registre, alors que celui-ci appartient à Nextcloud (AppAPI) et que l'image est construite sur l'hôte AIO.

`nextcloud/auto-update.sh` fait le même travail, lancé par cron toutes les 5 minutes :
1. il fait un `git fetch` et ne fait rien d'autre si `main` n'a pas bougé ;
2. il suspend la mise à jour si le clone du serveur contient des modifications locales ;
3. il sauvegarde le volume de l'app (`backup-exapp.sh`) — pas de sauvegarde, pas de mise à jour ;
4. il fait `git pull`, puis `install-aio.sh`. Le build a lieu avant la réinstallation : si le build échoue,
   l'app reste en place.

Mise en place, une fois, sur l'hôte AIO (en root) — le clone doit suivre `main` :
```bash
cd /opt/budgetpbdbcompta && git checkout main && git pull
(crontab -l 2>/dev/null; echo "*/5 * * * * /opt/budgetpbdbcompta/nextcloud/auto-update.sh >> /var/log/budgetpbdbcompta-autoupdate.log 2>&1") | crontab -
```
Une fusion dans `main` met alors à jour **les deux versions** en moins de 5 minutes : AIServer par Watchtower,
Nextcloud par ce script. Suivi : `tail -f /var/log/budgetpbdbcompta-autoupdate.log`.

### Manuellement

1. Incrémenter `<version>` et `<image-tag>` dans `nextcloud/appinfo/info.xml` pour une version marquante. Pour
   un correctif courant, ce n'est pas obligatoire : l'image est republiée sous le même numéro.
2. Lancer `npm test` et les contrôles de `budget-app.html`, puis passer par une PR dans `main`.
3. Sur le serveur AIO :
   ```bash
   cd /opt/budgetpbdbcompta && git pull && git log --oneline -1
   bash nextcloud/install-aio.sh 2>&1 | tee /root/budgetpbdbcompta-update.log
   ```
   Le script réenregistre l'app sans perte de données.
4. Dans le navigateur : `Ctrl+F5`.

## Correspondance des identifiants

Les droits sont indexés par l'identifiant d'annuaire (`a.porrati`). En ExApp, le serveur le retrouve dans
cet ordre :
1. par l'identifiant Nextcloud, dans l'annuaire (compte de service, `LDAP_SEARCH_FILTER`) ;
2. à défaut, par l'adresse de courrier Nextcloud. Nextcloud identifie parfois un utilisateur LDAP par un
   **UUID**, que ni les droits ni l'annuaire ne connaissent ;
3. à défaut, par l'identifiant Nextcloud tel quel.

Si une personne n'a pas ses droits habituels, regarder dans Paramètres › Mon compte l'identifiant reconnu, et
comparer avec :
```bash
docker exec --user www-data nextcloud-aio-nextcloud php occ user:info <identifiant-nextcloud>
```

## Limites

- **Menu :** l'entrée est visible par tous les utilisateurs de Nextcloud ; seuls les membres du groupe entrent.
- **Prise en compte des changements :** un retrait du groupe est effectif en 60 s au plus
  (`IDENTITY_CACHE_SECONDS`), une modification de l'annuaire en 5 min au plus (`LDAP_CACHE_SECONDS`).
- **Image :** construite localement sur le serveur AIO. Elle n'est pas publiée par GitHub Actions, qui ne
  publie que l'image de production.

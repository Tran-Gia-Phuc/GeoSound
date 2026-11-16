# Production release flow

How a tested build of `staging` becomes a release `vX.Y.Z` running in `geosound-prod`.
Deployment plan section 9 (`docs/02-design/deployment-plan.md`), phase 3 task 3.5 (issue #390).

**Status: documentation only** (decision P3-6). Steps 1 to 4 work today. Steps 5 and 6 need a production cluster that does not exist yet, and some settings that only the **repo owner** can make (marked *owner*). Section 6 lists what is missing.

## 0. Branches and tags

| Ref | What it holds | Who writes the image tag | Deployed by |
| --- | --- | --- | --- |
| `develop` | integration of feature branches | nobody (its tags are old and never edited) | nothing |
| `staging` | the next release candidate | CI job `promote` (bot commit after every build, task 3.2) | Argo CD `geosound-staging`, automated sync, PostSync smoke test |
| `main` | released code | a reviewed pull request on `deploy/envs/prod/values.yaml` | Argo CD `geosound-prod`, **manual** Sync |
| tag `vX.Y.Z` | one release, on a commit of `main` | none (the images get the tag) | nothing by itself |

The `global.image.tag` line of each environment file is written on one branch only (`staging` for staging, `main` for prod). The other branches never touch it, so the pull requests `develop` → `staging` → `main` never conflict on it.

## 1. Release candidate on staging

1. Open a pull request `develop` → `staging` and merge it with a merge commit when CI is green.
2. CI on `staging`: tests, then `images.yml` builds or retags the 9 images as `sha-<7>` and `staging`, then job `promote` commits `chore: deploy sha-<7> to staging`.
3. Argo CD syncs `geosound-staging` within about 75 seconds; the PostSync Job `geosound-smoke` checks every app and `GET /api/tours`. Discord gets the result (task 3.4).
4. Use staging for at least one day (checklist, section 4).

## 2. Merge into `main` and tag the release

1. Open a pull request `staging` → `main`, merge with a merge commit when CI is green. CI on `main` gives every image the tags `sha-<7>` (of the merge commit) and `main`. The job `promote` does not run on `main`.
2. Tag the merge commit and push the tag (semantic versioning: a breaking API or data change bumps the major number, a feature the minor, a fix the patch):

   ```bash
   git fetch origin
   git tag -a v1.0.0 origin/main -m "GeoSound v1.0.0"
   git push origin v1.0.0
   ```

3. CI on the tag runs the tests again, then `images.yml` adds the tag `v1.0.0` to the images built for that commit on `main`. It does not rebuild: the run summary says `reused sha-<7>` for each of the 9 images. Check it in the Actions run before going on.

Tag only a commit of `main` that CI has built. A tag on another commit gets new images, which staging never ran.

## 3. Deploy to production

1. **Pull request on the prod tag.** From `main`, create a branch `release/v1.0.0`, set `global.image.tag: v1.0.0` in `deploy/envs/prod/values.yaml`, and open a pull request into `main` with the release notes in its body. Only that line changes.
2. **Review.** At least one teammate other than the author approves. *Owner:* make this a rule with a branch protection on `main` (Settings → Branches: require a pull request and one approval, no force push).
3. **The `production` environment** (plan 9.1). *Owner:* Settings → Environments → New environment `production`, required reviewers = the people who may release, deployment branches = `main` and tags `v*`. Planned use (not built, P3-6): a CI job on `v*` tags with `environment: production` waits for a reviewer, then opens the pull request of step 1 itself. Until then step 1 is done by hand.
4. **Merge** the pull request. Nothing is deployed yet: `geosound-prod` has no automated sync, so Argo CD shows it **OutOfSync**.
5. **Sync.** In the Argo CD UI, open `geosound-prod`, check the diff (only the image fields of the Deployments and the migrate Job should change), then **Sync**. From a terminal: `argocd app sync geosound-prod`. The order is:
   - PreSync: the Job `geosound-migrate` applies pending migrations (they must be backward compatible, checklist item 3);
   - the Deployments roll one pod at a time, readiness gates the traffic;
   - PostSync: the smoke test, if `smoke.enabled` is set in the prod values (off today; it is read only, so it may be turned on).
6. Watch for 15 minutes (section 4, after the sync).

The `geosound-prod` Application, for the day the cluster exists (not committed yet, so that nobody applies it by mistake):

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: geosound-prod
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/Tran-Gia-Phuc/GeoSound.git
    targetRevision: main
    path: deploy/helm/geosound
    helm:
      releaseName: geosound # selectors and Service names depend on it
      valueFiles:
        - ../../envs/prod/values.yaml
  destination:
    server: https://kubernetes.default.svc
    namespace: geosound-prod
  syncPolicy: # no `automated`: every production change is a manual Sync
    syncOptions:
      - CreateNamespace=false
      - ServerSideApply=true
```

Use `application.resourceTrackingMethod: annotation` in that Argo CD too (see `deploy/argocd/values-local.yaml`).

## 4. Release checklist

From plan section 9.3, with what exists today.

Before the tag:

1. Staging has run the same images for at least one day, the last Argo CD sync of `geosound-staging` is green (smoke test included) and nothing failed in Discord.
2. CI and the Trivy scan are green on the `main` commit to tag.
3. The migrations in this release are backward compatible: the old code must still run on the new schema, because pods roll one at a time and a rollback does not undo a migration (plan 8.5).
4. Release notes written in the pull request of section 3 step 1 (a `CHANGELOG.md` does not exist yet); tag `vX.Y.Z` follows semantic versioning.

After the sync:

5. `geosound-prod` is Synced and Healthy, every pod Ready, no restart loop (`kubectl -n geosound-prod get pods`).
6. The site opens, the tour list loads, a sign in works with a real account (production has no test accounts and no OTP in the logs).
7. For 15 minutes: no rise in 5xx or latency. With phase 4: the Grafana overview; until then the gateway log (`kubectl -n geosound-prod logs deploy/gateway --since 15m`).

## 5. Rollback

Plan section 9.2.

- **Fast:** Argo CD UI → `geosound-prod` → History and rollback → pick the previous synced revision → Rollback. The pods go back to the previous tag in a few minutes. Git still says the new tag, so the app shows OutOfSync until the clean rollback below; do not press Sync before it.
- **Clean:** a pull request on `main` that sets `global.image.tag` back to the previous `vX.Y.Z` (or `git revert` the release pull request), reviewed and merged, then Sync. Old images stay in GHCR, so any earlier tag can be deployed again.
- **Database:** migrations only go forward. A bad migration is fixed with a new migration in a new release, never by editing an applied one. A rollback of the code is safe only because of checklist item 3.
- **Staging** rolls back the same way, but through `staging`: revert the merge on `staging` (the bot then writes the tag of the revert build), or pause its auto-sync first (runbook `k3s-cluster.md` section B5) if the UI rollback should hold.

## 6. What is still missing

| Missing | Needed for | Who |
| --- | --- | --- |
| A production cluster (the VM of the runbook `k3s-cluster.md` part A, namespace `geosound-prod`) with Argo CD, cert-manager and Sealed Secrets | everything in section 3 | team |
| DNS: the real host instead of `geosound.example.com` in `deploy/envs/prod/values.yaml`, an A record to the VM, port 80 open for Let's Encrypt | HTTPS | team |
| Production secrets sealed with the prod cluster's certificate (`scripts/deploy/seal-secrets.sh prod <env-file>`), including `geosound-smtp` (required in prod: without it OTP codes would go to the log) and a production database | the pods start | team, values never in Git |
| GHCR pull secret, if the packages stay private | image pulls | owner |
| Environment `production` with required reviewers; branch protection on `main` | section 3 steps 2 and 3 | owner |
| The CI job that opens the prod pull request after a `v*` tag | automation of section 3 step 1 | later task |
| `CHANGELOG.md`; dashboards and alerts (phase 4) | checklist items 4 and 7 | later tasks |

# Development

```sh
npm ci
npm run typecheck   # tsc --noEmit
npm test            # unit, Vite and e2e tests (vitest)
npm run build       # tsup into dist/
npm run test:pack   # packs the package, installs the tarball into a fresh Vite app, builds it and audits it
npm run demo:dev    # demo site with the dev overlay
npm run demo:build  # prerender the demo into dist-demo/
```

`npm run test:pack` is kept out of `npm test`: it builds `dist`, runs `npm pack`, and installs the tarball with `vite`, `react`, `react-dom` and `react-router` from the npm registry into a temp app copied from `test/fixtures/pack-app`, so it needs the network (or a warm npm cache). Set `PACK_VITE=5|6|7|8` to pick the app's Vite major (default 8).

Tests that need a real browser use your installed Chrome. They are skipped when Chrome cannot be launched; set `WFA_CHROME=skip` to always skip them, or `WFA_CHROME=require` to fail instead of skipping (CI does this).

To run the Vite tests against another Vite major, swap it in without touching the lockfile, then run them:

```sh
node scripts/install-vite.mjs 5
npx vitest run test/vite test/e2e test/cli/audit.e2e.test.ts
npm ci   # back to the locked versions
```

CI runs one job on every push and pull request (Node 22: typecheck, tests, build, pack and the demo build). The full matrix (Node 20.19, 22 and 24, Vite 5 to 7, and the packed package against Vite 5 to 8) runs only when started manually with "Run workflow" on the Actions tab, for example before a release.

The demo in `examples/demo` uses every feature; its README lists what each page shows.

## Releasing

Releases are published by `.github/workflows/release.yml` when a version tag is pushed. It runs a single job (typecheck, tests, build), fails if the tag does not match the `version` in `package.json`, and publishes with npm trusted publishing (OIDC). There is no `NPM_TOKEN`, and provenance is attached automatically. The job never runs on forks. Tags with a hyphen (`v0.5.0-beta.1`) publish under the `next` dist-tag; others under `latest`.

1. Run the manual CI matrix from the Actions tab if the release touches Vite or Node support.
2. Bump the version without tagging: `npm version 0.4.0 --no-git-tag-version`.
3. Update `CHANGELOG.md` and commit.
4. Tag and push: `git tag v0.4.0 && git push origin master v0.4.0`.
5. Watch the "Release" run on the Actions tab.

### One-time npm setup

1. The package must already exist on npm (publish the first version by hand if it does not).
2. On npmjs.com open the package, then Settings, then Trusted publisher, and choose GitHub Actions.
3. Enter organization or user `LazyyVenom`, repository `Web-For-Agents`, workflow filename `release.yml` (filename only, with the extension). Leave environment empty. Allow `npm publish`.
4. Save. All fields are case-sensitive and npm does not check them until the first publish, which must succeed within 2 days or the setting expires.
5. Optional: under Publishing access, require 2FA and disallow tokens.

Requirements: npm CLI 11.5.1 or later (the workflow installs the latest npm), Node 22.14 or later, the `id-token: write` permission, a GitHub-hosted runner, and `repository.url` in `package.json` matching the GitHub repository exactly.

## Troubleshooting

- After upgrading the package, restart the Vite dev server or run `vite --force`. Vite caches optimized dependencies and can keep serving the old build.
- Release fails with a 404 or "unable to authenticate": check the trusted publisher fields (owner, repo and workflow filename are case-sensitive) and that npm is 11.5.1 or later.

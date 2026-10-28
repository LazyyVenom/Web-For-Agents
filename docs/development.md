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

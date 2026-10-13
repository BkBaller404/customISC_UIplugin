# SailPoint UI Plugin (Angular starter)

An ISC-hosted Angular plugin in the `customuiplugin` project. It uses the SailPoint UI Plugin SDK to search identities, view profile attributes and source accounts, inspect account activity, submit account enable/disable requests, and launch assigned workflows.

**Plugin guide:** see [`SAILPOINT_PLUGIN_GUIDE_ANGULAR.md`](./SAILPOINT_PLUGIN_GUIDE_ANGULAR.md) for how to use the SDK via `SailpointPluginService`, the `sp-ui-plugin.json` manifest, local development against a live tenant, and deployment. That guide is the canonical, self-contained reference for building this plugin.

Identity search posts a text query to ISC's Search API against the identities index, matching across names, email, and alias. API requests use the plugin SDK's handshake token instead of the Angular API interceptor's forced token refresh; the linked shell in this environment is currently timing out on `SP_GET_CURRENT_TOKEN_RES`.

## Commands

```bash
npm start        # HTTPS dev server for local in-tenant development
npm run build    # production build
npm test         # unit tests
```

Run these commands from the `customuiplugin` directory. After `sail ui-plugins link`, restart the dev server if the CLI changed `angular.json`, then open the URL returned by the CLI inside ISC. Do not link or serve `isc-ui-enhancer`; this project is the registered `customuiplugin` alias.

ISC does not provide direct equivalents for IIQ's JSF injection, BeanShell, Debug XML, task scheduler/cache controls, snapshots, or IIQ-backed notes and notifications. Those need separately designed ISC workflows or a secured backend.

Scaffold new building blocks with the Angular CLI. For example, run `ng generate component my-feature`. Run `ng generate --help` for the full list.

## Additional resources

- [`SAILPOINT_PLUGIN_GUIDE_ANGULAR.md`](./SAILPOINT_PLUGIN_GUIDE_ANGULAR.md) — plugin guide (SDK usage, config, deployment)
- [Angular CLI reference](https://angular.dev/tools/cli) — this project was generated with Angular CLI 20.2.2

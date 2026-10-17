# RsBan RPC compatibility — fork validation

Source: [Nault RPC PR #672](https://github.com/Nault/Nault/pull/672).

This is an adaptation, **not a cherry-pick**. TheBananoStand already passes a JSON object and `json_block: true` for `process`; unlike Nault it uses `@dev-ptera/nano-node-rpc` and Spyglass for receivable-block discovery.

## Changes

- Prefer existing Spyglass enriched receivable results; if Spyglass fails, query the **selected RPC node** with `receivable`, `source: 'true'` and `include_only_confirmed: 'true'`.
- Convert the user-configured Banano threshold to raw before the RPC request.
- Retry with `pending` **only** on a recognized action refusal (`Action receivable not allowed` / `Unknown command`); keep the same URL and propagate unrelated failures.
- Preserve actual RPC failures from `account_info` instead of sending an undefined response to the formatter.
- Keep already-correct `process` serialization unchanged, including Kalium-specific `do_work` behavior. Do not change PoW, signing, network constants, or the Ledger transport.

This is *not* a replacement for Spyglass's enriched transaction history, aliases, price data or representative scores. RPC-fallback receivables do not include timestamps unless supplied by the RPC.

## Manual setup in TheBananoStand (test RsBan without changing Spyglass)

1. Open **Settings** in a **locally built version of this PR** (same UI as [TheBananoStand Settings](https://thebananostand.com/settings)). The public production site can be used for a *baseline RsBan connection check* but cannot validate changes that exist only on this unmerged branch.
2. Under **Data Sources → Node RPC Datasource**, click **Add New**.
3. In the **Add new Banano RPC Node** dialog, fill **RPC Node URL** with the complete URL of the test RsBan HTTP JSON-RPC endpoint (for example, an HTTPS reverse-proxy path to the local RsBan RPC server, **not** the node monitoring dashboard) and click **Add**.
4. Under **Node RPC Datasource → Custom Entries**, confirm the new `Custom node #N` entry is marked **Online** and selected. Choose its radio button if needed. The availability check sends `{"action":"block_count"}`.
5. **Do not modify Spyglass API Datasource.** Leave the currently selected **Prussia Node** entry at `https://spyglass-api.prussia.dev/banano`. This is intentional: Spyglass continues to provide enriched receivable metadata, filtered history, aliases, prices and representative information, while RsBan handles node RPC requests.
6. Test account balance/representative display and the authorized Ledger send/receive/open/change flows via the new custom RPC source. **Verify the selected source stays the custom RsBan node.** To specifically test the *Spyglass outage → RsBan receivable fallback*, simulate Spyglass unavailability in an isolated test, restore it afterward, and confirm that the wallet shows incoming blocks via the custom RPC endpoint. This fallback is **not** exercised while Prussia Node is working.

**Browser access:** from the hosted `https://thebananostand.com`, the RPC URL must be reachable by the browser over HTTPS with a valid certificate and appropriate CORS response for that origin. A bare `http://localhost:7072` URL is not a suitable endpoint on that HTTPS site. Never expose an unrestricted `process`/wallet-management RPC publicly; restrict allowed actions and authenticate/limit the proxy as appropriate. A monitor URL such as `https://twister32.ddns.info/` does **not** necessarily serve JSON-RPC.

**Selection note:** Prussia Node is a selectable Spyglass source in the code, not a globally hardcoded default. Preserve the user's existing selection; the application can automatically choose among accessible Spyglass sources during initialization.

## Validation gates

- [ ] CI: `npm ci --legacy-peer-deps` (or the upstream-supported `yarn`), `npm run lint`, `npm run test:ci`, `npm run build` and existing Cypress suite.
- [ ] Public Banano RPC compatibility: account lookup; send, receive/open, change; block signing with Ledger; PoW locally and from a server.
- [ ] RsBan: `version`, `block_count`, `account_info`, `receivable`, `process`, `work_generate`, `work_cancel`, `blocks_info`, `block_info`. Read-only requests first; **do not submit actual blocks until wallet authorization and test amounts are confirmed**.
- [ ] Kill Spyglass in a local test: receivable discovery still works through the selected RPC.
- [ ] Refuse `receivable` at proxy: exactly one same-endpoint legacy retry; unrelated failures must remain visible.
- [ ] For older proxy/node, confirm `pending` support; verify empty / malformed responses and account-not-found semantics.
- [ ] Check correct Banano genesis, `ban_` addresses, raw/BAN conversion, confirmation and sync height. No Nano live-chain fallback.
- [ ] Inspect CI logs on this fork and perform wallet-level manual tests before leaving Draft.

## Existing Banano node → RsBan migration

Upstream RsNano explicitly supports Banano via `--features banano --bin rsban`. Verify the compiled binary was built with that feature; the Nano binary is not a substitute.

Default Banano ports from `types/src/currency_constants/banano.rs`: P2P TCP **7071**, RPC **7072**, WebSocket **7074**. The current monitored installation may use different values.

1. Inventory current bananode version, sync/confirmation height, vote status, RPC/proxy/monitor addresses, node identity, data directory, backups and configuration. **Do not stop production yet.**
2. Back up configuration, wallet data (if any), representative/node identity and the entire ledger directory; secure private keys separately. Never publish seeds, private keys, passwords or public write-enabled RPC.
3. Build RsBan from a pinned `rsnano-node` commit or verified image. For a source build: `cargo build --release --features banano --bin rsban`. Run `target/release/rsban --help` before assuming flags or config paths.
4. Prefer a **separate data directory**, separate configuration and distinct P2P/RPC/WebSocket ports on a staging host. Do not open the same LMDB database simultaneously in bananode and RsBan; verify format compatibility before any database copy. A clean bootstrap may be safer than an in-place migration.
5. Verify `version`, `block_count`, peers, cemented/confirmed heights and expected representative voting status. Match monitoring endpoints to the new node with least-privilege access.
6. Test TheBananoStand against a **custom RPC endpoint** pointing to staged RsBan, then validate the Ledger transaction paths with explicitly authorized low-value transfers.
7. Switch public monitor and reverse proxy only after sync and functional tests pass; retain a documented rollback to the original node/datadir. Keep RPC bound to localhost or behind authenticated, action-limited HTTPS proxy.

Monitoring URL provided by operator: https://twister32.ddns.info/ . No remote server files, status or configuration were modified as part of this PR.

## Important limits

- This implementation does not replace `@dev-ptera/nano-node-rpc` wholesale, nor normalize unused `blocks_info` responses, as existing TheBananoStand code does not require the Nault-specific contents transformation.
- Banano network consensus and epoch parameters are maintained in the RsBan backend; avoid changing them in the wallet.
- Automated unit tests are added, but the live RsBan node and Ledger have **not** been exercised from this patch.

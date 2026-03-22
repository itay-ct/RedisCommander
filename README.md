# Redis Commander

> **Live site:** [redis-commander.pages.dev](https://redis-commander.pages.dev/)

Keyboard-first Redis command explorer with a DOS-inspired terminal UI, vendored Redis docs content, client API-method flipping, and animated ASCII category art.

## Update Source

Source of truth lives under:

- `vendor/redis-docs/content/commands`
- `vendor/redis-docs/data/command-api-mapping`

Refresh from `redis/docs`:

1. `npm run sync:redis-docs`
2. `npm run scrape`
3. `npm run validate:data`
4. `npm run build`

Manual updates are fine too: copy those two upstream folders into the vendored paths above, then rerun `scrape`, `validate:data`, and `build`.

`npm run dev` starts the app.

Made by: itay.tevel@redis.com

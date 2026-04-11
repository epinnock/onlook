# cf-esm-cache

R2-backed cache Worker that fronts the `cf-esm-builder` Worker.

## Flow

For `GET /pkg/<package>`:

1. Compute a cache key from the request URL.
2. Look up the bundle in R2 (`PACKAGES` binding).
   - HIT: return the cached body with `X-Cache: HIT` and an immutable
     `Cache-Control` header.
3. On miss, forward the request to the `ESM_BUILDER` service binding.
   - If upstream is not OK, pass the response through unchanged
     (errors are not cached).
   - If upstream is OK, persist the body to R2 and return it with
     `X-Cache: MISS`.

Any request not under `/pkg/` returns `404 esm-cache: unknown route`.

## Required R2 bucket

The Worker depends on an R2 bucket named **`onlook-expo-packages`**. Create
it once, manually, before deploying:

```sh
wrangler r2 bucket create onlook-expo-packages
```

## Local dev

```sh
bun run dev
```

# GitHub Publishing Checklist

Use this before making the repository public.

## Secrets and environment

- [ ] `.env` is excluded and not staged
- [ ] `.env.local` is excluded and not staged
- [ ] no real `JWT_SECRET` value appears anywhere in tracked files
- [ ] no real database password appears anywhere in tracked files
- [ ] no real agent keys appear anywhere in tracked files
- [ ] no real enrollment tokens appear anywhere in tracked files

## Infrastructure details

- [ ] no real public domain names remain in docs/examples
- [ ] no internal IP addresses remain in docs/examples
- [ ] no reverse-proxy configs point at personal infrastructure names
- [ ] no user-specific compose overrides are tracked

## Application data

- [ ] no seeded customer data is committed
- [ ] no private tenant/member data is committed
- [ ] no exported snapshots/logs with private data are committed

## Repository shape

- [ ] `.env.example` contains placeholders only
- [ ] deployment docs point to `app.example.com`-style placeholders
- [ ] first-run bootstrap flow is documented
- [ ] upgrade/migration steps are documented
- [ ] optional lab/demo services are clearly marked as optional

## Recommended spot checks

```bash
git grep -n "example.com\|192\.168\.\|password\|token"
git status --short
```

If those searches return anything installation-specific or credential-like, clean it before publishing.

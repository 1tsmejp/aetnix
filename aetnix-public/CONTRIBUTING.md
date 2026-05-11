# Contributing to AETNIX

Thanks for taking a look at AETNIX.

## Ground rules

- keep changes focused and reviewable
- prefer simple, explicit behavior over cleverness
- do not commit secrets, private infrastructure details, or local `.env` files
- document deployment-impacting changes in `README.md` or `docs/deployment.md`

## Development notes

This project currently ships as a compact multi-service Docker stack:

- `frontend/`
- `backend/`
- `agent/`
- `database/`

For local work:

```bash
cp .env.example .env
docker compose up --build
```

## Pull request expectations

A solid PR should usually include:

- a clear summary of what changed
- notes on any migration or deployment impact
- verification steps (build, syntax check, manual flow, or API proof)

## Security and privacy

If a contribution touches auth, deployment, secrets, tokens, or agent trust boundaries, call that out explicitly in the PR description.

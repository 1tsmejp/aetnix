# Security Policy

## Reporting a vulnerability

If you discover a security issue in AETNIX, please avoid posting full exploit details in a public issue before maintainers have a chance to review it.

Until a dedicated private reporting channel is published, share:

- affected component
- impact summary
- reproduction conditions
- suggested mitigation if known

## Sensitive areas

Please treat these areas with extra care:

- authentication and session handling
- tenant isolation and authorization
- agent enrollment and credential exchange
- deployment defaults and environment variables
- reverse-proxy and CORS behavior
- any feature that could expose customer or infrastructure data

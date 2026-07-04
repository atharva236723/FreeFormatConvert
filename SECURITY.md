# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability, please report it **privately** rather
than opening a public issue.

- Preferred: use GitHub's
  [private vulnerability reporting](https://github.com/atharva236723/FreeFormatConvert/security/advisories/new)
  (Security tab → "Report a vulnerability").
- Alternatively, reach out via the [contact form](https://freeformatconvert.com/contact).

Please include steps to reproduce and, if possible, the affected browser/OS.
We aim to acknowledge reports within a few days.

## Scope

Free Format Convert is a fully static, client-side application — there is no
backend and no user data is stored or transmitted. The most relevant classes of
issue are therefore:

- Cross-site scripting (XSS) or content-injection in the rendered pages.
- Supply-chain issues in bundled dependencies.
- Misconfiguration of security headers (`public/_headers`) or the Cloudflare
  Workers deployment.

## Supported versions

Only the latest deployed version (`main`) is supported. There are no
maintained release branches.

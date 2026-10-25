# archspec.io

The website for [archspec](https://archspec.io): a landing page, the user guide and the
playground. It is a static site built from an archspec checkout, so the diagrams, findings and
command-line output on the pages are produced by the real engine and stay current with it.

| Path | What | Made from |
|---|---|---|
| `/` | Landing page | `src/index.html`, with diagrams and findings rendered at build time |
| `/docs/` | User guide | archspec's `docs/instructions.md`; its live examples are rendered at build time |
| `/playground/` | The web app | archspec's `web/dist/archspec-playground.html`, with a head and a strict CSP added |

Like the app, the site loads nothing from other hosts: system fonts, no analytics, no CDNs.
Every page sends a Content-Security-Policy as a `<meta>` tag; the playground's blocks every
outbound connection (`connect-src 'none'`).

## Build

Needs Node 22 and an archspec checkout next to this one (or pass its path).

```bash
npm install
(cd ../archspec && npm install)
node build.mjs ../archspec          # → dist/; also builds archspec's playground
npx --yes serve dist                # http://localhost:3000
```

The build fails if an internal link or `#anchor` doesn't resolve, or if the playground's
security policy can't be added.

## Layout

```
build.mjs          builds dist/ from src/ and an archspec checkout
src/layout.html    page shell: header, footer, meta tags, CSP
src/index.html     landing page body ({{placeholders}} are filled by build.mjs)
src/docs.html      docs page body: contents sidebar + guide
src/404.html       not-found page
src/style.css      styles, light and dark, matching the playground's palette
src/site.js        docs: highlights the section in view in the contents
src/favicon.svg    icon; also the logo in the header
```

To change wording on the landing page, edit `src/index.html`. To change the docs, edit
`docs/instructions.md` in archspec: the site and the app's Help tab share it.

## Deploy (GitHub Pages)

`.github/workflows/pages.yml` builds and publishes on every push to `main`, by hand from the
Actions tab (optionally from an archspec branch or tag), and when archspec sends a
`repository_dispatch` event of type `archspec-updated`.

One-time setup:

1. **Settings → Pages → Source: GitHub Actions.** Publishing Pages from a private repository
   needs a paid GitHub plan; otherwise make this repository public (it holds only the site).
2. **Secret `ARCHSPEC_TOKEN`** while archspec is private: a fine-grained personal access
   token with read-only *Contents* access to `nickvasilyev/archspec`.
3. **DNS** at your registrar, for the apex domain:

   | Type | Name | Value |
   |---|---|---|
   | A | `@` | `185.199.108.153` |
   | A | `@` | `185.199.109.153` |
   | A | `@` | `185.199.110.153` |
   | A | `@` | `185.199.111.153` |
   | AAAA | `@` | `2606:50c0:8000::153` |
   | AAAA | `@` | `2606:50c0:8001::153` |
   | AAAA | `@` | `2606:50c0:8002::153` |
   | AAAA | `@` | `2606:50c0:8003::153` |
   | CNAME | `www` | `nickvasilyev.github.io` |

4. **Settings → Pages → Custom domain: `archspec.io`**, then tick **Enforce HTTPS** once the
   certificate is issued (minutes to an hour after DNS resolves). Also verify the domain under
   your account's *Settings → Pages → Verified domains*, so no other repository can claim it.

To rebuild the site when archspec changes, add this step to a workflow in archspec, with a
token that can dispatch to this repository:

```yaml
- run: gh api repos/nickvasilyev/archspec.io/dispatches -f event_type=archspec-updated -f "client_payload[ref]=${{ github.sha }}"
  env:
    GH_TOKEN: ${{ secrets.SITE_DISPATCH_TOKEN }}
```

GitHub Pages can't send custom response headers. The CSP `<meta>` tags cover everything except
`frame-ancestors` (which only works as a header). If that matters later, the same `dist/` works
unchanged on Cloudflare Pages or S3 + CloudFront, which can add headers.

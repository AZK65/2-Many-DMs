# Public website on Cloudflare Pages

The public website is a **static export**, separate from the private messaging app. It reuses the reviewed marketing components, but `website/app` includes only the landing page, updates, privacy and a 404 page. There are no API routes, account connections, database bindings or server functions.

## Build and test

```sh
npm install
npm run website:build
wrangler pages dev website/out --port 3006
WEBSITE_STATIC=1 WEBSITE_QA_URL=http://127.0.0.1:3006 node scripts/verify-website.mjs
```

Install Cloudflare's Wrangler CLI and sign in with `wrangler login` before publishing. The build copies only explicitly listed public brand images, icons and the changelog, validates the resulting files, and writes to `website/out`. Never upload the repository root, the normal Next build, local uploads, .env or session directories. Keep any hosting secrets out of Git. Ordinary app installation does not build or deploy this site.

## Publish

```sh
npm run website:deploy
```

The Cloudflare Pages project is **2manydms**, with production branch **master**. It uses Direct Upload: a GitHub push alone does not publish the site. The deploy command rebuilds the public export and uploads only `website/out`. The source repository is public; personal workspaces, messages and account sessions are not part of this export.

Direct Upload projects cannot later be converted to native Git integration; a CI job can still run the same Pages upload command. No CI token or automatic deployment workflow has been configured.

After deployment, open the production Pages URL and check the logo, theme switch, mobile menu, setup-prompt modal, translation preview, changelog and privacy page. Confirm `/api/accounts`, `/api/assistant` and `/board` return 404.

## Custom domain

In Cloudflare, open **Workers & Pages → 2manydms → Custom domains → Set up a custom domain**. Domain and DNS changes are separate from publishing and are left to the owner. Canonical URLs and the sitemap currently use `https://2manydms.com`; update `src/lib/website-metadata.ts`, `website/public/robots.txt` and `website/public/sitemap.xml` if a different domain is selected.

## Brand mark

The complete WhatsApp silhouette in `PlatformIcon.tsx` is sourced from [Simple Icons](https://github.com/simple-icons/simple-icons/blob/develop/icons/whatsapp.svg) (CC0). Platform names and logos identify independent integrations, not an affiliation.

References: [Next.js static exports on Pages](https://developers.cloudflare.com/pages/framework-guides/nextjs/deploy-a-static-nextjs-site/), [Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/).

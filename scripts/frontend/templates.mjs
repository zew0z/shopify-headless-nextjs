// Plain error pages for a received frontend that has none. No styling beyond
// the basics: the frontend's designer can restyle them. Next 16.3 hands error
// boundaries `{ error, retry }`; older 16.x versions hand them `reset`, so the
// button uses whichever it gets. The message shows only in development, so a
// shopper never sees a stack of internals.

export const ERROR_PAGE = `"use client";

export default function Error({ error, retry, reset }: { error: Error & { digest?: string }; retry?: () => void; reset?: () => void }) {
  return (
    <main style={{ padding: "4rem 1.5rem", textAlign: "center" }}>
      <h1>Something went wrong</h1>
      {process.env.NODE_ENV !== "production" && <p>{error.message}</p>}
      <button type="button" onClick={() => (retry ?? reset)?.()}>
        Try again
      </button>
    </main>
  );
}
`;

// Replaces the whole page when the root layout itself fails, so it needs its own <html> and <body>.
export const GLOBAL_ERROR_PAGE = `"use client";

export default function GlobalError({ error, retry, reset }: { error: Error & { digest?: string }; retry?: () => void; reset?: () => void }) {
  return (
    <html lang="en">
      <body>
        <main style={{ padding: "4rem 1.5rem", textAlign: "center" }}>
          <h1>Something went wrong</h1>
          {process.env.NODE_ENV !== "production" && <p>{error.message}</p>}
          <button type="button" onClick={() => (retry ?? reset)?.()}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
`;

// Starter pages that read text the owner writes in the Shopify admin, for a frontend
// that has no policies/ or pages/ route. `sdk` is the import path of the kit's SDK
// from the page's folder. Next 16 hands pages and generateMetadata `params` as a Promise.

/** A legal policy from Shopify (Settings > Policies), at /policies/<handle>. The body is HTML the owner wrote in the Shopify admin. */
export const policyPage = (sdk) => `import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPolicy } from "${sdk}";

type Props = { params: Promise<{ handle: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  const policy = await getPolicy(handle);
  return policy ? { title: policy.title } : {};
}

export default async function PolicyPage({ params }: Props) {
  const { handle } = await params;
  const policy = await getPolicy(handle);
  if (!policy) notFound();
  return (
    <main>
      <h1>{policy.title}</h1>
      <div dangerouslySetInnerHTML={{ __html: policy.body }} />
    </main>
  );
}
`;

/** An info page from Shopify (Online Store > Pages), at /pages/<handle>. */
export const infoPage = (sdk) => `import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPage } from "${sdk}";

type Props = { params: Promise<{ handle: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  const page = await getPage(handle);
  return page ? { title: page.seo?.title ?? page.title, description: page.seo?.description ?? page.bodySummary } : {};
}

export default async function InfoPage({ params }: Props) {
  const { handle } = await params;
  const page = await getPage(handle);
  if (!page) notFound();
  return (
    <main>
      <h1>{page.title}</h1>
      <div dangerouslySetInnerHTML={{ __html: page.body }} />
    </main>
  );
}
`;

/** NOTIXV's container image: the standalone Next server, built only if tests, lint and build pass. */
export function dockerfile(pm) {
  const install = pm === "pnpm"
    ? "COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./\nRUN corepack enable && pnpm install --frozen-lockfile"
    : "COPY package*.json ./\nRUN npm ci --no-audit --fund=false";
  const run = pm === "pnpm" ? "pnpm" : "npm run";
  // lint only where the repo has the script: a received repo may not.
  const lint = pm === "pnpm" ? "pnpm run --if-present lint" : "npm run --if-present lint";
  return `# syntax=docker/dockerfile:1

# --- build -------------------------------------------------------------------
FROM node:24-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

${install}

COPY . .
# NEXT_PUBLIC_* is inlined into the browser bundle at build time, so the origin
# the site is served from has to be known here.
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
# Pages that read Shopify are pre-rendered at build time, so the build needs the
# shop's public Storefront settings. The public token ships to browsers by
# design; never pass the Admin token.
ARG NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN
ENV NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN=$NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN
ARG NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN
ENV NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN=$NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN
# The build needs a public/ folder to exist; a repo without one has none.
RUN mkdir -p public
# Publish only an image that passes the kit's tests and lint.
RUN ${run} test:scripts && ${lint} && ${run} build

# --- runtime -----------------------------------------------------------------
FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \\
    PORT=3000 \\
    HOSTNAME=0.0.0.0 \\
    NEXT_TELEMETRY_DISABLED=1

ARG GIT_COMMIT
LABEL org.opencontainers.image.revision=$GIT_COMMIT

# output: "standalone" emits a server with only the modules it traced; static/
# and public/ are the two things it does not copy itself.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

# The uid, not \`node\`: the chart sets runAsNonRoot and kubelet cannot verify a
# named user, so a non-numeric USER fails with CreateContainerConfigError.
USER 1000
EXPOSE 3000

CMD ["node", "server.js"]
`;
}

/** Keeps `COPY . .` from copying the host's node_modules, build output or env files over the image's. */
export const DOCKERIGNORE = `node_modules
.next
.git
.github
.vercel
*.log
.env
.env.*
test-results
playwright-report
frontend-audit.json
`;

/** NOTIXV's build-and-push workflow, the same in every shop repo: the image name and site url come from the repository name. */
export const DEPLOY_WORKFLOW = `name: Build & publish

on:
  push:
    branches: [dev, main]

concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read
  id-token: write          # required for Workload Identity Federation

env:
  PROJECT_ID: notixv
  REGION: europe-west3
  AR_REPO: landings
  IMAGE: \${{ github.event.repository.name }}

jobs:
  build:
    name: Build & push
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4

      # The origin is baked into the build - canonical and OG links, and the
      # framework's trusted-host list - so it cannot be read from the request. It
      # is the repository name under the landings zone, the same name the image has.
      # Once the real domain points here, a SITE_URL repository variable overrides it.
      - id: tag
        name: Derive image tag
        run: |
          SHA=$(git rev-parse --short HEAD)
          TS=$(date +%s)
          case "$GITHUB_REF" in
            refs/heads/dev)  TAG="dev-\${SHA}-\${TS}" ;;
            refs/heads/main) TAG="rel-\${SHA}-\${TS}" ;;
            *) echo "unexpected ref $GITHUB_REF" >&2; exit 1 ;;
          esac
          {
            echo "TAG=$TAG"
            echo "SITE_URL=https://\${IMAGE}.landings.notixv.com"
            echo "IMAGE_URL=\${REGION}-docker.pkg.dev/\${PROJECT_ID}/\${AR_REPO}/\${IMAGE}:\${TAG}"
          } >> "$GITHUB_OUTPUT"

      - uses: google-github-actions/auth@v2
        with:
          # A resource name, not a secret: the --attribute-condition and the
          # workloadIdentityUser binding are what gate its use. Identical in
          # every NOTIXV repo - it names the provider, not the repository.
          workload_identity_provider: projects/559585018204/locations/global/workloadIdentityPools/github/providers/github
          service_account: gh-actions@notixv.iam.gserviceaccount.com

      - uses: google-github-actions/setup-gcloud@v2
      - run: gcloud auth configure-docker \${{ env.REGION }}-docker.pkg.dev --quiet

      - uses: docker/setup-buildx-action@v3
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: \${{ steps.tag.outputs.IMAGE_URL }}
          # The two SHOPIFY_* values are GitHub repository variables (Settings >
          # Secrets and variables > Actions > Variables), set once per shop. They
          # are the public Storefront settings, not secrets.
          build-args: |
            NEXT_PUBLIC_SITE_URL=\${{ vars.SITE_URL || steps.tag.outputs.SITE_URL }}
            GIT_COMMIT=\${{ github.sha }}
            NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN=\${{ vars.SHOPIFY_STORE_DOMAIN }}
            NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN=\${{ vars.SHOPIFY_STOREFRONT_ACCESS_TOKEN }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
          # Attestations publish extra sha256-*.att tags that clutter the
          # registry and confuse tag scanning.
          provenance: false

      - name: Summary
        run: |
          echo "Pushed \\\`\${{ steps.tag.outputs.TAG }}\\\` for \${{ steps.tag.outputs.SITE_URL }}" >> $GITHUB_STEP_SUMMARY
          echo "Flux deploys it on the ImageRepository's next scan." >> $GITHUB_STEP_SUMMARY
`;

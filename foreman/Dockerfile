# Node 22, because the app runs TypeScript directly through the runtime's
# type-stripping rather than compiling to a dist/ nobody reads. What is
# deployed is what is in the repository.
FROM node:22-slim

# tini reaps the zombies a Node process running `git` and `npm` will otherwise
# leave behind, and forwards SIGTERM so the graceful shutdown actually runs.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git tini \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first, so a change to source does not reinstall the world.
#
# Optional ones are left out, so the built-in model engine is not in the image.
# That is deliberate: it would add hundreds of megabytes in order to run weights
# that a machine small enough to be cheap cannot hold anyway. A deployed Foreman
# is the case for setting ANTHROPIC_API_KEY, and it says so at boot if you have
# not.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional

COPY src ./src
COPY web ./web
COPY tsconfig.json ./

# Nothing here needs root, and a container that cannot write to its own image
# is one fewer thing to think about.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

ENV NODE_ENV=production \
    FOREMAN_HOST=0.0.0.0 \
    FOREMAN_HOME=/data \
    PORT=8080

EXPOSE 8080

# The health check is the app's own, so a container that is up but cannot
# answer is restarted rather than left in the load balancer.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--experimental-strip-types", "src/server/index.ts"]

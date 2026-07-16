# Cold Trail — detective case game (zero-dependency Node server)
FROM node:22-alpine
WORKDIR /app
COPY packages ./packages
COPY apps ./apps
# users + daily-case results persist in apps/server/data. In production, mount
# a persistent volume at that path (Railway Volumes / Render disk / fly.toml
# mount). Create the dir and hand it to the non-root runtime user so writes
# succeed even before a volume is attached.
RUN mkdir -p apps/server/data && chown -R node:node apps/server/data
ENV NODE_ENV=production PORT=5177
EXPOSE 5177
USER node
CMD ["node", "apps/server/server.js"]

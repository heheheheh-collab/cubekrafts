# Cold Trail — detective case game (zero-dependency Node server)
FROM node:22-alpine
WORKDIR /app
COPY packages ./packages
COPY apps ./apps
# users + daily-case results persist in apps/server/data. In production, mount a
# persistent volume at that path (Railway Volumes / Render disk / fly.toml mount).
# We run as root (the image's default) so the process can write to that volume —
# Railway/Render mount volumes owned by root, and a non-root user can't write to
# them, which crashes the app on the first save.
RUN mkdir -p apps/server/data
ENV NODE_ENV=production PORT=5177
EXPOSE 5177
CMD ["node", "apps/server/server.js"]

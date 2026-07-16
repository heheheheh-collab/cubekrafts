# Cold Trail — detective case game (zero-dependency Node server)
FROM node:22-alpine
WORKDIR /app
COPY packages ./packages
COPY apps ./apps
# users + daily-case results persist here — mount a volume in production.
# Create it and hand ownership to the non-root runtime user so writes succeed.
RUN mkdir -p apps/server/data && chown -R node:node apps/server/data
ENV NODE_ENV=production PORT=5177
VOLUME /app/apps/server/data
EXPOSE 5177
USER node
CMD ["node", "apps/server/server.js"]

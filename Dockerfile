# Cold Trail — detective case game (zero-dependency Node server)
FROM node:22-alpine
WORKDIR /app
COPY packages ./packages
COPY apps ./apps
ENV NODE_ENV=production PORT=5177
# users + daily-case results persist here — mount a volume in production
VOLUME /app/apps/server/data
EXPOSE 5177
USER node
CMD ["node", "apps/server/server.js"]

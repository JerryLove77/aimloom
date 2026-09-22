FROM node:22.23.2-bookworm-slim AS development

WORKDIR /workspace
RUN chown node:node /workspace
USER node

# Keep dependency installation cached until a workspace manifest or lock changes.
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node packages/app/package.json ./packages/app/package.json
COPY --chown=node:node packages/core/package.json ./packages/core/package.json
COPY --chown=node:node packages/crosshair/package.json ./packages/crosshair/package.json
RUN npm ci --no-audit --no-fund \
    && mkdir -p packages/app/node_modules packages/core/node_modules packages/crosshair/node_modules

# .dockerignore includes only the browser app, TypeScript core and test corpus.
COPY --chown=node:node . .

EXPOSE 5173
CMD ["npm", "run", "dev:installer", "-w", "@kvk/app", "--", "--host", "0.0.0.0"]

FROM development AS installer-build
RUN npm run build:installer

# Export the static frontend without including Node, dependencies or test data.
FROM scratch AS installer-artifact
COPY --from=installer-build /workspace/packages/app/dist-installer/ /

FROM node:16.10.0-alpine3.12

ENV NODE_ENV production

RUN mkdir -p /apps/bff

WORKDIR /apps/bff
COPY --chown=node:node package.json package-lock.json /apps/bff/
RUN npm install --only=production

COPY --chown=node:node dist /apps/bff/dist

EXPOSE 5010

USER node
CMD [ "node", "dist/index.js" ]

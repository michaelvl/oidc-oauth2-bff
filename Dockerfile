FROM node:16.10.0-alpine3.12

ENV NODE_ENV production

RUN mkdir -p /usr/src/app/bff

WORKDIR /usr/src/app/bff
COPY --chown=node:node package.json package-lock.json /usr/src/app/bff/
RUN npm install --only=production

COPY --chown=node:node dist /usr/src/app/bff/dist

EXPOSE 5010

USER node
CMD [ "node", "dist/index.js" ]

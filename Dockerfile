FROM node:16.10.0-alpine3.12

ENV NODE_ENV production

RUN mkdir -p /usr/src/app/bff

COPY --chown=node:node dist /usr/src/app/bff/dist
COPY --chown=node:node src package.json package-lock.json /usr/src/app/bff/
RUN cd /usr/src/app/bff && npm install --only=production

EXPOSE 5000

WORKDIR /usr/src/app/bff
USER node
CMD [ "node", "dist/index.js" ]

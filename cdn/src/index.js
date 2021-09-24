const express = require('express');
const serveStatic = require('serve-static');

const port = process.env.CLIENT_PORT || 5010;
const dist = process.env.STATIC_FILES_PATH || '../spa/dist';

const app = express();

app.use((req, res, next) => {
    // See https://infosec.mozilla.org/guidelines/web_security
    let policy = "default-src 'none';";
    policy += " script-src 'self' https://code.jquery.com https://unpkg.com;";
    policy += " connect-src 'self' http://localhost:5000;";
    res.setHeader('content-security-policy', policy);
    next();
});

app.use(serveStatic(dist, {
  maxAge: '0'
}));

app.listen(port, () => {
    console.log(`Pseudo-CDN listening on port ${port}, supplying files from ${dist}`);
});

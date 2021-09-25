const express = require('express');
const serveStatic = require('serve-static');

const port = process.env.CLIENT_PORT || 5000;
const dist = process.env.STATIC_FILES_PATH || '../spa/dist';
const csp_connect_sources = process.env.CSP_CONNECT_SOURCES || ''

const app = express();

app.use((req, res, next) => {
    // See https://infosec.mozilla.org/guidelines/web_security
    let policy = "default-src 'none';";
    policy += " connect-src 'self' " + csp_connect_sources + ";";
    policy += " script-src 'self' https://code.jquery.com https://unpkg.com;";
    policy += " style-src 'self';";
    res.setHeader('content-security-policy', policy);
    next();
});

if (app.get('env') != 'production') {
    app.use(serveStatic(dist, {
        maxAge: '0'  // Don't cache data
    }));
}

app.listen(port, () => {
    console.log(`Pseudo-CDN listening on port ${port}, supplying files from ${dist}`);
});

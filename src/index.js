const express = require('express');
const session = require('express-session');
const cors = require('cors');
const redis = require('redis')
const randomstring = require("randomstring");
const urlParse = require("url-parse");
const logger = require('morgan');
const { Issuer, generators, TokenSet } = require('openid-client');

const port = process.env.CLIENT_PORT || 5010;
const redirect_url = process.env.REDIRECT_URL;
const client_id = process.env.CLIENT_ID;
const client_secret = process.env.CLIENT_SECRET;
const oidc_issuer_url = process.env.OIDC_ISSUER_URL;
const oidc_scope = process.env.OIDC_SCOPE || 'openid profile';
const redis_url = process.env.REDIS_URL;
const session_secret = process.env.SESSION_SECRET;
const cors_allow_origin = process.env.CORS_ALLOW_ORIGIN;

console.log('CLIENT_ID', client_id);
console.log('CLIENT_SECRET', client_secret);
console.log('REDIRECT_URL', redirect_url);
console.log('OIDC_ISSUER_URL', oidc_issuer_url);
console.log('OIDC_SCOPE', oidc_scope);
console.log('REDIS_URL', redis_url);
console.log('CORS_ALLOW_ORIGIN', cors_allow_origin);

const app = express();
app.use(logger('combined'));
app.use(express.json());

if (cors_allow_origin) {
    app.use(cors({
        origin: cors_allow_origin,
        credentials: true
    }));
}

const session_config = { secret: session_secret,
                         resave: false,
                         saveUninitialized: false,
                         cookie: {
                             httpOnly: true,
                             sameSite: 'strict'
                         }
                       };
if (app.get('env') === 'production') {
    app.set('trust proxy', 1)
    session_config.cookie.secure = true
}
if (redis_url) {
    console.log('Using Redis session store');
    const RedisStore = require('connect-redis')(session)
    const redisClient = redis.createClient({ url: redis_url });
    redisClient.on('connect', () => { console.log('Redis connected'); });
    redisClient.on('error', (err) => { console.log('Redis error', err); });
    redisClient.on('reconnecting', () => { console.log('Redis reconnecting'); });
    session_config.store = new RedisStore({ client: redisClient,
                                            ttl: 60*60*12  // Seconds
                                          });
} else {
    console.log('Using Memory session store');
}
app.use(session(session_config));

function storeTokens(session, tokenSet) {
    console.log('Received and validated tokens %j', tokenSet);
    console.log('Validated ID Token claims', tokenSet.claims());
    session.id_token = tokenSet.id_token
    session.id_token_claims = tokenSet.claims();
    session.access_token = tokenSet.access_token;
    session.refresh_token = tokenSet.refresh_token;
    session.expires_at = tokenSet.expires_at;
}

function tokensValid(session) {
    const expire_in = session.expires_at - Date.now()/1000;
    console.log('Tokens expire in', expire_in);
    return session.id_token && expire_in > 0;
}

Issuer.discover(oidc_issuer_url)
    .then(function (issuer) {
        console.log('Discovered issuer %s %O', issuer.issuer, issuer.metadata);

        // Client settings for authorization code flow
        const client = new issuer.Client({
            client_id: client_id,
            client_secret: client_secret,
            usePKCE: true,  // Use authorization code flow with PKCE as standardized by OAuth2.1
            redirect_uris: [redirect_url],
            response_types: ['code'],
            token_endpoint_auth_method: 'client_secret_basic' // Send auth in header
        });

        app.post('/start', (req, res) => {
            // State, nonce and PKCE provide protection against CSRF in various forms. See:
            // https://danielfett.de/2020/05/16/pkce-vs-nonce-equivalent-or-not/
            const state = Buffer.from(randomstring.generate(24)).toString('base64');
            const nonce = Buffer.from(randomstring.generate(24)).toString('base64');
            const pkce_verifier = generators.codeVerifier();
            const pkce_challenge = generators.codeChallenge(pkce_verifier);
            const auth_url = client.authorizationUrl({
                scope: oidc_scope,
                code_challenge: pkce_challenge,
                code_challenge_method: 'S256',
                state, nonce
            });
            console.log('Return authRedirUrl:', auth_url);
            req.session.pkce_verifier = pkce_verifier
            req.session.state = state
            req.session.nonce = nonce
            res.status(200).json({authRedirUrl: auth_url});
        });

        app.post('/pageload', (req, res) => {
            const pageUrl = req.body.pageUrl
            console.log('pageload url', pageUrl);
            const data = urlParse(pageUrl, true).query;
            if (data.code && data.state && req.session.state) {
                const params = client.callbackParams(pageUrl);
                console.log('pageload params', params);
                client.callback(redirect_url, params, { code_verifier: req.session.pkce_verifier,
                                                        state: req.session.state,
                                                        nonce: req.session.nonce })
                    .then((tokenSet) => {
                        storeTokens(req.session, tokenSet);
                        res.status(200).json({loggedIn: true,
                                              handledAuth: true});
                    }).catch ((error) => {
                        console.log('Error finishing login:', error);
                        res.status(200).json({loggedIn: false,
                                              handledAuth: false});
                        req.session.destroy()
                    });
            } else {
                res.status(200).json({loggedIn: !!req.session.id_token,
                                      handledAuth: false});
            }
        });

        app.get('/userinfo', (req, res) => {
            if (tokensValid(req.session)) {
                console.log('ID token claims', req.session.id_token_claims);
                res.status(200).json(req.session.id_token_claims);
            } else {
                console.log('*** Tokens expired');
                res.status(200).json({});
            }
        });

        app.post('/logout', (req, res) => {
            if (req.session.id_token) {
                url = client.endSessionUrl({
                    id_token_hint: req.session.id_token,
                    post_logout_redirect_uri: redirect_url
                })
                res.status(200).json({logoutUrl: url});
            } else {
                console.log('*** No ID token claims');
                res.status(200).json({});
            }
            req.session.destroy()
        });

        app.post('/refresh', (req, res) => {
            if (req.session.refresh_token) {
                console.log('Refreshing tokens, access_token expires_at', req.session.expires_at);
                client.refresh(req.session.refresh_token)
                    .then((tokenSet) => {
                          storeTokens(req.session, tokenSet);
                        res.status(200).json({expiresAt: req.session.expires_at,
                                              loggedIn: true,
                                              refreshOk: true});
                    }).catch ((error) => {
                        console.log('Error refreshing tokens:', error);
                        res.status(200).json({loggedIn: false,
                                              handledAuth: false});
                        req.session.destroy()
                    });
            } else {
                res.status(200).json({loggedIn: false,
                                      refreshOk: false});
            }
        });
    });

app.listen(port, () => {
    console.log(`BFF listening on port ${port}!`);
});

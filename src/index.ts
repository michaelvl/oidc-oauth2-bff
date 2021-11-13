import express from 'express';
import session from 'express-session';
import cors from 'cors';
import redis from 'redis';
import randomstring from 'randomstring';
import urlParse from 'url-parse';
import logger from 'morgan';
import oidcClient from 'openid-client';
import process from 'process';

process.on('SIGINT', () => {
  console.info("Interrupted")
  process.exit(0)
})

const port = process.env.CLIENT_PORT || 5010;
const redirect_url = process.env.REDIRECT_URL;
const client_id = process.env.CLIENT_ID;
const client_secret = process.env.CLIENT_SECRET;
const oidc_issuer_url = process.env.OIDC_ISSUER_URL;
const oidc_scope = process.env.OIDC_SCOPE || 'openid profile';
const redis_url = process.env.REDIS_URL;
const session_secret = process.env.SESSION_SECRET;
const cors_allow_origin = process.env.CORS_ALLOW_ORIGIN;
const config_trust_proxies = process.env.CONFIG_TRUST_PROXIES || 1;
const base_path = process.env.BASE_PATH || '/';

console.log('CLIENT_ID', client_id);
console.log('CLIENT_SECRET', client_secret);
console.log('REDIRECT_URL', redirect_url);
console.log('OIDC_ISSUER_URL', oidc_issuer_url);
console.log('OIDC_SCOPE', oidc_scope);
console.log('REDIS_URL', redis_url);
console.log('CORS_ALLOW_ORIGIN', cors_allow_origin);

if ( ! oidc_issuer_url) {
   console.error('*** Env OIDC_ISSUER_URL not set');
   process.exit(1);
}
if ( ! client_id || ! client_secret) {
   console.error('*** Env CLIENT_ID or CLIENT_SECRET not set');
   process.exit(1);
}
if ( ! redirect_url) {
   console.error('*** Env REDIRECT_URL not set');
   process.exit(1);
}

const app = express();
const router = express.Router();
app.use(base_path, router);
router.use(logger('combined'));
router.use(express.json());

if (cors_allow_origin) {
    app.use(cors({
        origin: cors_allow_origin,
        credentials: true
    }));
}

declare module 'express-session' {
    interface SessionData {
        id_token: string;
        id_token_claims: object;
        access_token: string;
        refresh_token: string;
        state: string;
        nonce: string;
        pkce_verifier: string;
	expires_at: number;
    }
}

const session_config : session.SessionOptions = { secret: session_secret,
                         resave: false,
                         saveUninitialized: false,
                         cookie: {
                             httpOnly: true,
                             sameSite: 'strict'
                         }
                       };
if (app.get('env') === 'production') {
    console.log('Using trust proxy', config_trust_proxies);
    app.set('trust proxy', config_trust_proxies)
    console.log('Using secure cookie');
    session_config.cookie.secure = true
}
if (redis_url) {
    console.log('Using Redis session store');
    const RedisStore = require('connect-redis')(session)
    const redisClient = redis.createClient({ url: redis_url });
    redisClient.on('connect', () => { console.log('Redis connected'); });
    redisClient.on('error', (err: redis.RedisError) => { console.log('Redis error', err); });
    redisClient.on('reconnecting', () => { console.log('Redis reconnecting'); });
    session_config.store = new RedisStore({ client: redisClient,
                                            ttl: 60*60*12  // Seconds
                                          });
} else {
    console.log('Using Memory session store');
}
router.use(session(session_config));

function storeTokens(session: session.Session & Partial<session.SessionData>, tokenSet: oidcClient.TokenSet) {
    console.log('Received and validated tokens %j', tokenSet);
    console.log('Validated ID Token claims', tokenSet.claims());
    session.id_token = tokenSet.id_token
    session.id_token_claims = tokenSet.claims();
    session.access_token = tokenSet.access_token;
    session.refresh_token = tokenSet.refresh_token;
    session.expires_at = tokenSet.expires_at;
}

function tokensValid(session: session.Session & Partial<session.SessionData>) {
    const expire_in = session.expires_at - Date.now()/1000;
    console.log('Tokens expire in', expire_in);
    return session.id_token && expire_in > 0;
}

oidcClient.Issuer.discover(oidc_issuer_url)
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

        router.post('/start', (req, res) => {
            // State, nonce and PKCE provide protection against CSRF in various forms. See:
            // https://danielfett.de/2020/05/16/pkce-vs-nonce-equivalent-or-not/
            const state = Buffer.from(randomstring.generate(24)).toString('base64');
            const nonce = Buffer.from(randomstring.generate(24)).toString('base64');
            const pkce_verifier = oidcClient.generators.codeVerifier();
            const pkce_challenge = oidcClient.generators.codeChallenge(pkce_verifier);
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

        router.post('/pageload', (req, res) => {
            const pageUrl = req.body.pageUrl
            console.log('pageload url', pageUrl);
            const data = urlParse(pageUrl, true).query;
            if (data.code && data.state && req.session.state) {
                const params = client.callbackParams(pageUrl);
                console.log('pageload params', params);
                client.callback(redirect_url, params, { code_verifier: req.session.pkce_verifier,
                                                        state: req.session.state,
                                                        nonce: req.session.nonce })
                    .then((tokenSet: oidcClient.TokenSet) => {
                        storeTokens(req.session, tokenSet);
                        res.status(200).json({loggedIn: true,
                                              handledAuth: true});
                    }).catch ((error) => {
                        console.log('Error finishing login:', error);
                        res.status(200).json({loggedIn: false,
                                              handledAuth: false});
                        req.session.destroy(() => {});
                    });
            } else {
                res.status(200).json({loggedIn: !!req.session.id_token,
                                      handledAuth: false});
            }
        });

        router.get('/userinfo', (req, res) => {
            if (tokensValid(req.session)) {
                console.log('ID token claims', req.session.id_token_claims);
                res.status(200).json(req.session.id_token_claims);
            } else {
                console.log('*** Tokens expired');
                res.status(200).json({});
            }
        });

        router.post('/logout', (req, res) => {
            if (req.session.id_token) {
                const url = client.endSessionUrl({
                    id_token_hint: req.session.id_token,
                    post_logout_redirect_uri: redirect_url
                })
                res.status(200).json({logoutUrl: url});
            } else {
                console.log('*** No ID token claims');
                res.status(200).json({});
            }
            req.session.destroy(() => {});
        });

        router.post('/refresh', (req, res) => {
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
                        req.session.destroy(() => {});
                    });
            } else {
                res.status(200).json({loggedIn: false,
                                      refreshOk: false});
            }
        });
    }).catch((error) => {
        console.log('Error during Identity Provider discovery:', error);
        process.exit(1);
    });

app.listen(port, () => {
    console.log(`BFF listening on port ${port}!`);
});

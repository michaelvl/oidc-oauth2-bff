const express = require('express');
const session = require('express-session');
const cors = require('cors');
const bodyParser = require('body-parser');
const redis = require('redis')
const randomstring = require("randomstring");
const querystring = require("querystring");
const urlParse = require("url-parse");
//const https = require('https');
const https = require('http');
const jwt_decode = require('jwt-decode');

const port = process.env.CLIENT_PORT || 5000;
const redir_url = process.env.REDIR_URL;
const client_id = process.env.CLIENT_ID;
const client_secret = process.env.CLIENT_SECRET;
const oidc_auth_url = process.env.OIDC_AUTH_URL;
const oidc_token_url = process.env.OIDC_TOKEN_URL;
const oidc_scope = process.env.OIDC_SCOPE || 'openid profile';
const redis_url = process.env.REDIS_URL;
const session_secret = process.env.SESSION_SECRET || randomstring.generate(32);
const cors_allow_origin = process.env.CORS_ALLOW_ORIGIN;

console.log('CLIENT_ID', client_id);
console.log('CLIENT_SECRET', client_secret);
console.log('OIDC_AUTH_URL', oidc_auth_url);
console.log('OIDC_TOKEN_URL', oidc_token_url);
console.log('OIDC_SCOPE', oidc_scope);
console.log('REDIS_URL', redis_url);
console.log('CORS_ALLOW_ORIGIN', cors_allow_origin);

const app = express();
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));

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

app.get('/start', (req, res) => {
    let state = Buffer.from(randomstring.generate(24)).toString('base64');
    let nonce = Buffer.from(randomstring.generate(24)).toString('base64');

    let url = oidc_auth_url + '?' + querystring.encode({
        response_type: 'code',
        client_id: client_id,
        scope: oidc_scope,
        redirect_uri: redir_url,
        state: state,
        nonce: nonce
    });
    console.log('Return authRedirUrl:', url);
    req.session.state = state
    req.session.nonce = nonce
    res.status(200).json({authRedirUrl: url});
});

app.post('/continue', (req, res) => {
    console.log('POST', req.originalUrl)

    let pageUrl = req.body.pageUrl
    let data = urlParse(pageUrl, true).query;
    let code = data.code
    let idp_state = data.state

    if (code && req.session.state == idp_state) {
        console.log('Login continuation using code', code, 'and state', idp_state);
        // This is a confidential client - authorize towards IdP with client id and secret
        const client_creds = 'Basic ' + Buffer.from(querystring.escape(client_id)+':'+querystring.escape(client_secret), 'ascii').toString('base64')
        const data = querystring.encode({
            code: code,
            grant_type: 'authorization_code',
            redirect_uri: redir_url});
        const options = {
            method: 'POST',
            headers: {
                'Authorization': client_creds,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': data.length
            }
        };

        // Exchange code for tokens using the token endpoint
        const post = https.request(oidc_token_url, options, (post_resp) => {
            if (post_resp.statusCode != 200) {
                console.log('statusCode:', post_resp.statusCode);
                res.status(500).send();
            } else {
                post_resp.on('data', (data) => {
                    const token_data = JSON.parse(data);
                    console.log('Token response', token_data);
                    if (token_data.id_token) {
                        req.session.id_token =  token_data.id_token;
                        console.log('ID token', req.session.id_token);

                        // TODO: Validate signature on id_token

                        req.session.id_token_claims = jwt_decode(req.session.id_token);
                        console.log('ID token claims', req.session.id_token_claims);
                    }
                    if (token_data.access_token) {
                        req.session.access_token = token_data.access_token
                        console.log('Access token', req.session.access_token);
                    }               
                    if (token_data.refresh_token) {
                        req.session.refresh_token = token_data.refresh_token
                        console.log('Refresh token', req.session.refresh_token);
                    }
                    res.status(200).json({loggedIn: true});
                });
            }
        });
        post.write(data);
        post.end();
    } else {
        if (!code) {
            console.log('Error, code missing.');
        }
        if (req.session.state != idp_state) {
            console.log('Error, state mismatch.', req.session.state, 'vs', idp_state);
        }
        console.log('req.body', req.body);
        console.log('req.session', req.session);
        return res.status(200).json({loggedIn: false});
    }

});

app.get('/userinfo', (req, res) => {
    console.log('GET', req.originalUrl)
    if (req.session.id_token_claims) {
        console.log('ID token claims', req.session.id_token_claims);
        res.status(200).json(req.session.id_token_claims);
    } else {
        console.log('*** No ID token claims');
        res.status(200).json({});
    }
});

app.listen(port, () => {
    console.log(`Client listening on port ${port}!`);
});

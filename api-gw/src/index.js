const express = require('express');
const session = require('express-session');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');
const redis = require('redis')
//const https = require('https');
const https = require('http');
const logger = require('morgan');

const port = process.env.CLIENT_PORT || 5020;
const session_secret = process.env.SESSION_SECRET;
const cors_allow_origin = process.env.CORS_ALLOW_ORIGIN;
const redis_url = process.env.REDIS_URL;
const upstream_url = process.env.UPSTREAM_URL;

console.log('UPSTREAM_URL', upstream_url);
console.log('REDIS_URL', redis_url);
console.log('CORS_ALLOW_ORIGIN', cors_allow_origin);

const app = express();
app.use(logger('combined'));

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

function onProxyReq(proxyReq, req, res) {
    proxyReq.setHeader('authorization', 'Bearer '+req.session.access_token);
}

app.use('/api', createProxyMiddleware({
    target: upstream_url,
    changeOrigin: true,
    pathRewrite: {'^/api' : ''},
    onProxyReq: onProxyReq
}));

app.listen(port, () => {
    console.log(`API-GW listening on port ${port}!`);
});

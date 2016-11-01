const Koa = require('koa');

const app = new Koa();
const router = require('koa-router')();

router.get('/ping', (ctx) => {
  ctx.body = 'pong';
});

router.get('/cache/max-age/:second', (ctx) => {
  ctx.set('Cache-Control', `public, max-age=${ctx.params.second}`);
  ctx.body = 'Hello World';
});

router.get('/no-cache', (ctx) => {
  ctx.set('Cache-Control', 'public, no-cache');
  ctx.body = 'Hello World';
});

router.get('/400', (ctx) => {
  ctx.set('Cache-Control', 'public, max-age=10');
  ctx.status = 400;
  ctx.body = 'Hello World';
});

router.get('/500', (ctx) => {
  ctx.set('Cache-Control', 'public, max-age=10');
  ctx.status = 500;
  ctx.body = 'Hello World';
});

router.get('/set-cookie', (ctx) => {
  ctx.cookies.set('auth', 'tree.xie')
  ctx.set('Cache-Control', 'public, max-age=10');
  ctx.body = 'Hello World';
})

router.post('/post', (ctx) => {
  ctx.body = {};
});

const server = app
  .use((ctx, next) => {
    console.info(ctx.url);
    return next();
  })
  .use(router.routes())
  .use(router.allowedMethods())
  .listen(8000);

console.info('server listen on 8000');

module.exports = server;
const Koa = require('koa');

const app = new Koa();
const router = require('koa-router')();

router.get('/cache/max-age/:second', (ctx) => {
  ctx.set('Cache-Control', `public, max-age=${ctx.params.second}`);
  ctx.body = 'Hello World';
});

router.get('/no-cache', (ctx) => {
  ctx.set('Cache-Control', 'public, no-cache');
  ctx.body = 'Hello World';
});

router.get('/40x', (ctx) => {
  ctx.set('Cache-Control', 'public, max-age=10');
  ctx.status = 400;
});

router.get('/50x', (ctx) => {
  ctx.status = 500;
});

app
  .use(router.routes())
  .use(router.allowedMethods())
  .listen(3000);

console.info('server listen on 3000');

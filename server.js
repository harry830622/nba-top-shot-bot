const Koa = require('koa');
const Router = require('koa-router');
const bodyParser = require('koa-bodyparser');
const { bottender } = require('bottender');
const mongoose = require('mongoose');

require('dotenv').config();

const { NODE_ENV, PORT, KEY, MONGODB_URI } = process.env;

(async () => {
  const port = Number(PORT) || 5000;

  const bot = bottender({
    dev: NODE_ENV !== 'production',
  });

  const botHandler = bot.getRequestHandler();

  await bot.prepare();

  await mongoose.connect(MONGODB_URI);

  const server = new Koa();
  server.keys = [KEY];

  server.use(bodyParser());
  server.use((ctx, next) => {
    ctx.req.body = ctx.request.body;
    ctx.req.rawBody = ctx.request.rawBody;
    return next();
  });

  const router = new Router();

  router.all('(.*)', async (ctx) => {
    await botHandler(ctx.req, ctx.res);
    ctx.respond = false;
  });

  server.use(router.routes());

  server.listen(port, (err) => {
    if (err) throw err;
    console.log(`> Ready on http://localhost:${port}`);
  });
})();

# varnish vcl generator

## Installation

```bash
$ npm install varnish-generator
```


## API

```js
const varnishConfig = require('./config.json');
const varnishGenerator = require('varnish-generator');
varnishGenerator.getVcl(varnishConfig).then(vcl => {
	console.info(vcl);
}).catch(err => {
	console.error(err);
});
```
### varnishConfig

- `stale` 当varnish缓存过期之后多长时间还可用于返回，默认是`3s`

- `keep` 缓存过期之后，数据在过期多长时间可用于 If-Modified-Since / If-None-Match，默认是`10s`

- `grace` 缓存过期多长数据被删除（用于在所有backend都出问题时返回），默认是`30m`

- `backends` Array [{"name": "backendname", "prefix": "url prefix", "ip": "应用IP", "port": "应用端口"}]

## Check List

- 可缓存请求，首次无缓存时，从backend中获取数据

- 可缓存请求，已有缓存，从缓存中读取

- 可缓存请求，无缓存，多请求并发请求，一个请求从backend获取，其它的使用第一个请求的缓存（varnish返回的请求顺序不一）

- 可缓存请求，缓存请求刚过期，在stale时效内请求，请求从缓存中读取，varnish并从backend中更新数据

- 可缓存请求，缓存已过期，且非在stale时间内请求，后面的两个并发请求都由backend返回

- 不可缓存请求，首次请求，从backend中获取数据

- 不可缓存请求，多请求并发请求，第一个请求从backend读取，后续请求等第一个请求返回再从backend读取

- 不可缓存请求，已缓存（hit-for-pass），请求从backend读取

- 不可缓存请求，缓存已过期（hit-for-pass），请求从backend读取



## License

MIT
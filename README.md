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

## License

MIT
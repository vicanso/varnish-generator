# varnish vcl generator

## Installation

```bash
$ npm install varnish-generator -g
```

## RUN

```bash
varnish-generator -c ./examples/config.json -t ./examples/default.vcl
```

### varnishConfig

- `name` The varnish instance's name

- `stale` The seconds of stale, default is 3

- `directors` Director list, Array

- `directors.name` The director's name

- `directors.prefix` The prefix of the url for the director, optional

- `directors.host` The host for the director, optional

- `directors.type` The algorithm of load balance, it can be 'fallback', 'hash', 'random', 'round_robin'. The default is 'round_robin'

- `directors.backends` The backend list, Array

- `directors.backends.ip` The ip of backend

- `directors.backends.port` The port of backend

- ``directors.backends.weight` The weight of backend, it's used for `random` and `hash`

```json
{
  "name": "varnish-test",
  "stale": 2,
  "directors": [
    {
      "name": "timtam",
      "prefix": "/timtam",
      "director": "fallback",
      "backends": [
        {
          "ip": "127.0.0.1",
          "port": 3000
        },
        {
          "ip": "127.0.0.1",
          "port": 3010
        }
      ]
    },
    {
      "name": "dcharts",
      "prefix": "/dcharts",
      "host": "dcharts.com",
      "director": "hash",
      "hashKey": "req.http.cookie",
      "backends": [
        {
          "ip": "127.0.0.1",
          "port": 3020,
          "weight": 5
        },
        {
          "ip": "127.0.0.1",
          "port": 3030,
          "weight": 3
        }
      ]
    },
    {
      "name": "vicanso",
      "host": "vicanso.com",
      "director": "random",
      "backends": [
        {
          "ip": "127.0.0.1",
          "port": 3040,
          "weight": 10
        },
        {
          "ip": "127.0.0.1",
          "port": 3050,
          "weight": 5
        }
      ]
    },
    {
      "name": "aslant",
      "backends": [
        {
          "ip": "127.0.0.1",
          "port": 8000
        }
      ]
    }
  ]
}
```

## How to use varnish better?

View my [./default.vcl](example) of varnish vcl.

在使用varnish，我按照以下规则，

- 设置`default ttl`为0

- 缓存ttl通过后端响应`Cache-Control`来设置

- 不可缓存的请求通过`Cache-Control`来控制，或者请求时增加`Cache-Control:no-cache`参数，不通过配置特定url的方式来调整（简化varnish的配置，可以在所有项目共用）

### How the cache of varnish is created?

![](assets/cache_req_fsm.svg)

### RFC2616_Ttl



At first, let me show how the `varnish cache ttl` is created and the default setting,

- `default_grace` 10.000s

- `default_keep` 0.000s

- `default_ttl` 120.000s

[View the code](RFC2616_Ttl.md)

- HTTP status code is `302` or `307`, get the ttl from `Cache-Control` or `Expires`, otherwise is `-1`

- HTTP status code is `202`, `203`, `204`, `300`, `301`, `304`, `404`, `410`, `414`, get the ttl from `Cache-Control` or `Expires`, otherwise is `default ttl`

- Otherwise is `-1`

### Cache Grace

- The ttl is >= 0 , get the grace from field `stale-while-revalidate` of the response `Cache-Control` header

- Otherwise use the default grace


而我自己在使用`varnish`的实践中，发现有些时间客户没有控制好缓存的配置，因此我是选择设置`default_ttl`为0，Cache TTL 由backend返回的Cache-Control控制。我自己使用的`varnish`配置，主要通过以下的情况

### vcl_recv

- SPDY or HTTP/2.0 `synth(405)`

- method isn't GET HEAD PUT POST TRACE OPTIONS DELETE  `pipe`

- websocket `pipe`

- method isn't GET HEAD `pass`

- Authorization  `pass`

- request url "\?cache=false" or "&cache=false" or Cache-Control == "no-cache"  `pass`


注：如果是GET请求，发送方如果能确定该请求是不可以缓存的，尽量使用设置Request Cache-Control header 的方式

### vcl_backend_response

- ttl 小于0 设置该请求为不可缓存，ttl为120s，`deliver`

- response header Set-Cookie 不为空，设置该请求为不可缓存，ttl为120s，`deliver`

- response header Surrogate-Control ~ "no-store" ，设置该请求为不可缓存，ttl为120s，`deliver`

- response header Surrogate-Control 为空，而且 Cache-Control ~ "no-cache|no-store|private" ，设置该请求为不可缓存，ttl为120s，`deliver`

- response header Vary == '*'，设置该请求为不可缓存，ttl为120s，`deliver`

- 其它的情况(ttl由s-maxage or max-age等生成) `deliver`


## Test


根据配置好的`default.vcl`，启动`varnishd`，以及启动测试 server

```bash
varnishd -f ~/github/varnish-generator/examples/default.vcl -t -1 -p default_grace=1800 -p default_keep=10 -a :8001 -F

node test/support/server
```

### 不可缓存的请求

- POST/PUT等请求 `vcl_recv` --> `vcl_hash` --> `vcl_pass` --> `vcl_backend_fetch` --> `vcl_response` --> `vcl_deliver`

- 请求头中Cache-Control:no-cache或者url中query参数带有cache=false `vcl_recv` --> `vcl_hash` --> `vcl_pass` --> `vcl_backend_fetch` --> `vcl_response` --> `vcl_deliver`

- HTTP Status 不属于 202、203、204、300、301、302、304、307、404、410、414，响应头设置Cache-Control也无用 `vcl_recv` --> `vcl_hash` --> `vcl_miss` --> `vcl_backend_fetch` --> `vcl_response` --> `vcl_deliver`

- Set-Cookie、max-age=0 等由服务器端返回的数据导致不能缓存的，`vcl_recv` --> `vcl_hash` --> `vcl_miss` --> `vcl_backend_fetch` --> `vcl_response` --> `vcl_deliver`

### 可缓存的GET/HEAD请求

GET /cache/max-age/60 返回数据设置Cache-Control:public, max-age=60

- 无缓存，数据从backend中拉取 `vcl_recv` --> `vcl_hash` --> `vcl_miss` --> `vcl_backend_fetch` --> `vcl_response` --> `vcl_deliver`

- 有缓存且未过期，从缓存中返回，X-Hits + 1  `vcl_recv` --> `vcl_hash` --> `vcl_hit` --> `vcl_deliver`

- 有缓存且已过期，backend正常，过期时间未超过stale(3s)，从缓存中返回，且从backend中拉取数据更新缓存  `vcl_recv` --> `vcl_hash` --> `vcl_hit` --> `vcl_deliver` --> `vcl_backend_fetch` --> `vcl_response`

- 有缓存且已过期(也超过stale)，backend正常，从backend中拉取数据更新缓存 `vcl_recv` --> `vcl_hash` --> `vcl_miss` --> `vcl_backend_fetch` --> `vcl_response` --> `vcl_deliver`

- 有缓存且已过期，backend挂起，过期时间未超过grace(60s)，从缓存中返回 `vcl_recv` --> `vcl_hash` --> `vcl_hit` --> `vcl_deliver` --> `vcl_backend_fetch`

- 有缓存且已过期，backend挂起，过期时间超过grace(60s)，Backend fetch failed `vcl_recv` --> `vcl_hash` --> `vcl_miss` --> `vcl_backend_fetch` --> `vcl_deliver`


## License

MIT
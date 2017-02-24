# varnish vcl generator

[![Build Status](https://travis-ci.org/vicanso/varnish-generator.svg?branch=master)](https://travis-ci.org/vicanso/varnish-generator)
[![Coverage Status](https://img.shields.io/coveralls/vicanso/varnish-generator/master.svg?style=flat)](https://coveralls.io/r/vicanso/varnish-generator?branch=master)
[![npm](http://img.shields.io/npm/v/varnish-generator.svg?style=flat-square)](https://www.npmjs.org/package/varnish-generator)
[![Github Releases](https://img.shields.io/npm/dm/varnish-generator.svg?style=flat-square)](https://github.com/vicanso/varnish-generator)

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

- `varnish` The varnish version, support `'4'` and `'5'`, default is `'5'`

- `stale` The seconds of stale, default is 3

- `version` The vcl version , default is `new Date().toISOString()`

- `timeout` The timeout setting for all directors

  - `connect` The connect timeout, default is `2`

  - `firstByte` The firstByte timeout, default is `5`

  - `betweenBytes` The betweenBytes timeout, default is `2`

- `directors` Director list, Array

  - `name` The director's name

  - `prefix` The prefix of the url for the director, optional

  - `host` The host for the director, optional

  - `type` The algorithm of load balance, it can be 'fallback', 'hash', 'random', 'round_robin'. The default is 'round_robin'

  - `timeout` The director timeout setting, if not set , it will be use the global timeout setting
    - `connect` The connect timeout

    - `firstByte` The firstByte timeout

    - `betweenBytes` The betweenBytes timeout

  - `backends` The backend list, Array

    - `ip` The ip of backend

    - `port` The port of backend

    - `weight` The weight of backend, it's used for `random` and `hash`

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

Please read my [suggestion](https://github.com/vicanso/articles/blob/master/varnish-suggestion.md) about using varnish.

## How the cache of varnish is created?

![](./assets/cache_req_fsm.png)

## How to run

varnishd -f ./default.vcl -p default_ttl=0 -p default_grace=1800 -p default_keep=10 -a :8001 -F

## Using docker

```
docker pull vicanso/varnish

docker run -v $HOME/default.vcl:/etc/varnish/default.vcl -p 8001:80 -d --restart=always vicanso/varnish
```

## License

MIT

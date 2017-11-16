# 1.5.3
  * Support multi host for one director

# 1.5.0
  * Support `X-Server` to choose backend 

# 1.4.4
  * Fix the uncacheable is not do gzip

# 1.4.3
  * Support custom probe url

# 1.4.2
  * Varnish config support two more port’s setting: `port1,port2,port3` and `port1…port2`

# 1.4.1
  * Add "varnish" for `Server-Timing`

# 1.4.0
  * Change `varnish used` from `s` to `ms`

# 1.3.0
  * Supoort custom hash setting
  * Use `yaml.safeLoad` insteadof `yaml.load`

# 1.2.0
  * Improve the function to create `Server-Timing`
  * Support custom pass url setting
  * Support custom TTL for `hit-for-pass`
  * Change the default pass query (cache=false -> cache-control=no-cache)

# 1.1.0
  * Fix the hashKey config invalid
  * The config file support `yaml`
  * Use `Server-Timing` instead of `X-Varnish-Use`
